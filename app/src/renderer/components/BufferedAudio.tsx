import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type BufferedAudioProps = {
  src: string;
  autoPlay?: boolean;
  className?: string;
};

type AudioState = "loading" | "metadata" | "ready";

export const BufferedAudio = ({ src, autoPlay = false, className }: BufferedAudioProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [state, setState] = useState<AudioState>("loading");

  useEffect(() => {
    let canceled = false;
    let nextObjectUrl: string | undefined;
    setObjectUrl(undefined);
    setState("loading");

    fetch(src)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Audio request failed with ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        if (canceled) {
          return;
        }
        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
        setState("metadata");
      })
      .catch(() => {
        if (!canceled) {
          setObjectUrl(src);
          setState("metadata");
        }
      });

    return () => {
      canceled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [src]);

  const markReady = () => {
    const duration = audioRef.current?.duration;
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      setState("ready");
    }
  };

  useEffect(() => {
    if (state === "ready" && autoPlay) {
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [autoPlay, objectUrl, state]);

  const ready = state === "ready";

  return (
    <span className={`audio-buffer ${ready ? "is-ready" : ""} ${className ?? ""}`}>
      {!ready && (
        <span className="audio-loading" role="status">
          <Loader2 size={14} className="spin" />
          <span>{state === "loading" ? "Loading audio..." : "Preparing audio..."}</span>
        </span>
      )}
      {objectUrl && (
        <audio
          ref={audioRef}
          src={objectUrl}
          controls={ready}
          preload="auto"
          className={ready ? undefined : "audio-buffer-hidden"}
          onLoadedMetadata={markReady}
          onDurationChange={markReady}
          onCanPlayThrough={markReady}
        />
      )}
    </span>
  );
};

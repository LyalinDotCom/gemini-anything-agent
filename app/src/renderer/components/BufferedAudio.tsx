import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

type BufferedAudioProps = {
  src: string;
  autoPlay?: boolean;
  className?: string;
};

export const BufferedAudio = ({ src, autoPlay = false, className }: BufferedAudioProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [objectUrl, setObjectUrl] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let canceled = false;
    let nextObjectUrl: string | undefined;
    setObjectUrl(undefined);
    setLoading(true);

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
        setLoading(false);
      })
      .catch(() => {
        if (!canceled) {
          setObjectUrl(src);
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [src]);

  useEffect(() => {
    if (!loading && autoPlay) {
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [autoPlay, loading, objectUrl]);

  return (
    <span className={`audio-buffer ${!loading ? "is-ready" : ""} ${className ?? ""}`}>
      {loading && (
        <span className="audio-loading" role="status">
          <Loader2 size={14} className="spin" />
          <span>Loading audio...</span>
        </span>
      )}
      {objectUrl && (
        <audio
          ref={audioRef}
          src={objectUrl}
          controls={!loading}
          preload="auto"
          className={loading ? "audio-buffer-hidden" : undefined}
        />
      )}
    </span>
  );
};

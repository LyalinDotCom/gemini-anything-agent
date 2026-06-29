import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";

type BufferedAudioProps = {
  src: string;
  autoPlay?: boolean;
  className?: string;
};

const formatAudioTime = (seconds: number | undefined): string => {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

const fourCc = (view: DataView, offset: number): string =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );

const wavDurationFromBlob = async (blob: Blob): Promise<number | undefined> => {
  const header = await blob.slice(0, Math.min(blob.size, 262_144)).arrayBuffer();
  if (header.byteLength < 44) {
    return undefined;
  }

  const view = new DataView(header);
  if (fourCc(view, 0) !== "RIFF" || fourCc(view, 8) !== "WAVE") {
    return undefined;
  }

  let byteRate: number | undefined;
  let dataSize: number | undefined;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkId = fourCc(view, offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkId === "fmt " && chunkDataOffset + 16 <= view.byteLength) {
      byteRate = view.getUint32(chunkDataOffset + 8, true);
    }

    if (chunkId === "data") {
      dataSize = chunkSize || Math.max(0, blob.size - chunkDataOffset);
      break;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!byteRate || !dataSize) {
    return undefined;
  }

  const duration = dataSize / byteRate;
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
};

const audioDurationHint = async (blob: Blob, src: string): Promise<number | undefined> => {
  const lowerSrc = src.toLowerCase();
  const lowerType = blob.type.toLowerCase();
  if (lowerSrc.includes(".wav") || lowerType.includes("wav") || lowerType.includes("wave")) {
    return wavDurationFromBlob(blob);
  }
  return undefined;
};

export const BufferedAudio = ({ src, autoPlay = false, className }: BufferedAudioProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const autoPlayHandledRef = useRef(false);
  const [audioUrl, setAudioUrl] = useState<string>();
  const [directSource, setDirectSource] = useState(false);
  const [loading, setLoading] = useState(true);
  const [durationHint, setDurationHint] = useState<number>();
  const [duration, setDuration] = useState<number>();
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    let nextObjectUrl: string | undefined;
    const controller = new AbortController();
    setAudioUrl(undefined);
    setDirectSource(false);
    setLoading(true);
    setDurationHint(undefined);
    setDuration(undefined);
    setMetadataLoaded(false);
    setCurrentTime(0);
    setPaused(true);
    setLoadFailed(false);
    autoPlayHandledRef.current = false;

    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Audio request failed with ${response.status}`);
        }
        return response.blob();
      })
      .then(async (blob) => {
        const nextDurationHint = await audioDurationHint(blob, src);
        if (canceled) {
          return;
        }
        nextObjectUrl = URL.createObjectURL(blob);
        setDurationHint(nextDurationHint);
        if (nextDurationHint) {
          setDuration(nextDurationHint);
        }
        setAudioUrl(nextObjectUrl);
        setDirectSource(false);
        setLoading(false);
      })
      .catch((error) => {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        if (!canceled) {
          setAudioUrl(src);
          setDirectSource(true);
          setLoading(false);
        }
      });

    return () => {
      canceled = true;
      controller.abort();
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [src]);

  useEffect(() => {
    if (!duration && durationHint) {
      setDuration(durationHint);
    }
  }, [duration, durationHint]);

  const nativeFallback = Boolean(audioUrl && directSource && metadataLoaded && !duration && !loadFailed);
  const ready = Boolean(audioUrl && !loading && duration && duration > 0 && !loadFailed);

  useEffect(() => {
    if ((ready || nativeFallback) && autoPlay && !autoPlayHandledRef.current) {
      autoPlayHandledRef.current = true;
      void audioRef.current?.play().catch(() => undefined);
    }
  }, [autoPlay, nativeFallback, ready]);

  const syncDuration = () => {
    setMetadataLoaded(true);
    const nextDuration = audioRef.current?.duration;
    if (Number.isFinite(nextDuration) && nextDuration && nextDuration > 0) {
      setDuration(nextDuration);
      return;
    }
    if (durationHint) {
      setDuration(durationHint);
    }
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || !duration) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const seek = (value: string) => {
    const audio = audioRef.current;
    if (!audio || !duration) {
      return;
    }
    const nextTime = Math.min(duration, Math.max(0, Number(value)));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <span className={`audio-buffer ${!loading ? "is-ready" : ""} ${className ?? ""}`}>
      {(loading || (!ready && !nativeFallback)) && (
        <span className="audio-loading" role="status">
          {!loadFailed && <Loader2 size={14} className="spin" />}
          <span>{loadFailed ? "Audio could not be loaded." : loading ? "Loading audio..." : "Preparing audio..."}</span>
        </span>
      )}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          className={nativeFallback ? "audio-native" : undefined}
          controls={nativeFallback}
          preload="auto"
          onLoadedMetadata={syncDuration}
          onCanPlay={syncDuration}
          onDurationChange={syncDuration}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => {
            setPaused(true);
            setCurrentTime(duration ?? audioRef.current?.currentTime ?? 0);
          }}
          onError={() => setLoadFailed(true)}
        />
      )}
      {ready && (
        <span className="audio-player">
          <button
            type="button"
            className="audio-player-button"
            onClick={togglePlayback}
            aria-label={paused ? "Play audio" : "Pause audio"}
          >
            {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} fill="currentColor" />}
          </button>
          <span className="audio-player-time">
            {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
          </span>
          <input
            className="audio-player-scrub"
            type="range"
            min="0"
            max={duration ?? 0}
            step="0.01"
            value={Math.min(currentTime, duration ?? 0)}
            onChange={(event) => seek(event.currentTarget.value)}
            aria-label="Audio position"
          />
        </span>
      )}
    </span>
  );
};

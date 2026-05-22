'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface AudioScrubberHandle {
  seekTo: (seconds: number) => void;
}

interface AudioScrubberProps {
  src: string;
  durationSeconds?: number | null;
}

export const AudioScrubber = forwardRef<AudioScrubberHandle, AudioScrubberProps>(
  function AudioScrubber({ src, durationSeconds }, ref) {
    const audioRef = useRef<HTMLAudioElement>(null);

    useImperativeHandle(ref, () => ({
      seekTo(seconds: number) {
        if (audioRef.current) {
          audioRef.current.currentTime = seconds;
          void audioRef.current.play();
        }
      },
    }));

    return (
      <div className="rounded-lg border bg-gray-50 p-4">
        <audio
          ref={audioRef}
          controls
          src={src}
          className="w-full"
          aria-label={`Recording audio${durationSeconds ? ` (${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, '0')})` : ''}`}
        />
      </div>
    );
  },
);

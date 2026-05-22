'use client';

import type { NormalizedTranscript } from '@cema/integrations-deepgram';
import { useRef } from 'react';

import { AudioScrubber, type AudioScrubberHandle } from './audio-scrubber';
import { TranscriptViewer } from './transcript-viewer';

interface CommunicationPlayerProps {
  signedAudioUrl: string;
  durationSeconds: number | null;
  transcript: NormalizedTranscript | null;
}

export function CommunicationPlayer({
  signedAudioUrl,
  durationSeconds,
  transcript,
}: CommunicationPlayerProps) {
  const scrubberRef = useRef<AudioScrubberHandle>(null);

  function handleWordClick(startSeconds: number) {
    scrubberRef.current?.seekTo(startSeconds);
  }

  return (
    <div className="space-y-4">
      <AudioScrubber ref={scrubberRef} src={signedAudioUrl} durationSeconds={durationSeconds} />
      {transcript ? (
        <TranscriptViewer transcript={transcript} onWordClick={handleWordClick} />
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm font-medium">Transcript not yet available</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Transcription runs automatically after the call recording is ingested.
          </p>
        </div>
      )}
    </div>
  );
}

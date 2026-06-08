'use client';

import type { NormalizedTranscript } from '@cema/integrations-deepgram';

interface TranscriptViewerProps {
  transcript: NormalizedTranscript;
  onWordClick?: (startSeconds: number) => void;
}

const SPEAKER_COLORS = [
  'border-l-blue-500 bg-blue-50 dark:bg-blue-950/30',
  'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
  'border-l-sky-500 bg-sky-50 dark:bg-sky-950/30',
  'border-l-orange-500 bg-orange-50 dark:bg-orange-950/20',
];

function speakerLabel(speakerId: number): string {
  return `Speaker ${speakerId + 1}`;
}

export function TranscriptViewer({ transcript, onWordClick }: TranscriptViewerProps) {
  if (transcript.paragraphs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">
        Transcript is empty or not yet available.
      </p>
    );
  }

  return (
    <div className="space-y-3" aria-label="Call transcript">
      {transcript.paragraphs.map((para, i) => {
        const colorClass =
          SPEAKER_COLORS[para.speaker % SPEAKER_COLORS.length] ?? SPEAKER_COLORS[0]!;
        return (
          <div key={i} className={`rounded-r border-l-4 p-3 ${colorClass}`}>
            <p className="text-muted-foreground mb-1 text-xs font-semibold">
              {speakerLabel(para.speaker)}
              <span className="ml-2 font-normal opacity-60">{para.start.toFixed(1)}s</span>
            </p>
            <p className="text-foreground text-sm leading-relaxed">
              {onWordClick
                ? transcript.words
                    .filter((w) => w.start >= para.start && w.end <= para.end + 0.1)
                    .map((word, wi) => (
                      <button
                        key={wi}
                        type="button"
                        onClick={() => onWordClick(word.start)}
                        className="hover:text-blue-600 hover:underline focus:outline-none"
                        aria-label={`Jump to ${word.start.toFixed(1)}s`}
                      >
                        {word.text}{' '}
                      </button>
                    ))
                : para.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

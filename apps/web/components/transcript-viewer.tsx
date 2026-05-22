'use client';

import type { NormalizedTranscript } from '@cema/integrations-deepgram';

interface TranscriptViewerProps {
  transcript: NormalizedTranscript;
  onWordClick?: (startSeconds: number) => void;
}

const SPEAKER_COLORS = [
  'border-l-blue-500 bg-blue-50',
  'border-l-green-500 bg-green-50',
  'border-l-purple-500 bg-purple-50',
  'border-l-orange-500 bg-orange-50',
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
            <p className="mb-1 text-xs font-semibold text-gray-500">
              {speakerLabel(para.speaker)}
              <span className="ml-2 font-normal text-gray-400">{para.start.toFixed(1)}s</span>
            </p>
            <p className="text-sm leading-relaxed text-gray-800">
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

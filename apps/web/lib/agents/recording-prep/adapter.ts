import { FixtureRecordingAdapter, type RecordingAdapter } from '@cema/agents-recording-prep';

// Dormant FixtureRecordingAdapter today; the swap point for real Simplifile
// (statewide) + ACRIS (NYC) submission/polling adapters once vendor keys land.
export const recordingAdapter: RecordingAdapter = new FixtureRecordingAdapter();

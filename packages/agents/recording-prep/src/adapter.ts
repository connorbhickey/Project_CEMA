import type {
  RecordingAdapter,
  RecordingPlan,
  RecordingPollResult,
  RecordingSubmission,
} from './types';

/**
 * Dormant default recording adapter. submit() transmits nothing (submitted:false,
 * no submissionId) and poll() reports not_submitted -- the wiring default until
 * real Simplifile (statewide) + ACRIS (NYC) adapters are provisioned (vendor keys).
 * Also the test double for the dispatcher's dormant path.
 *
 * Methods are not `async` (they do no awaiting) -- they return resolved Promises to
 * satisfy the RecordingAdapter contract without tripping require-await. The
 * underscore-prefixed params satisfy no-unused-vars.
 */
export class FixtureRecordingAdapter implements RecordingAdapter {
  submit(_plan: RecordingPlan): Promise<RecordingSubmission> {
    return Promise.resolve({ submissionId: null, submitted: false });
  }

  poll(_submissionId: string): Promise<RecordingPollResult> {
    return Promise.resolve({ status: 'not_submitted' });
  }
}

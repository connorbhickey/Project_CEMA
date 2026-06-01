import { describe, expect, it } from 'vitest';

import {
  canTransitionChainBreak,
  isTerminalChainBreak,
  validChainBreakTransitions,
} from './chain-break-state';

describe('chain-break review state machine', () => {
  it('allows pending → claimed', () => {
    expect(canTransitionChainBreak('pending', 'claimed')).toBe(true);
  });

  it('allows claimed → pending | resolved | dismissed', () => {
    expect(canTransitionChainBreak('claimed', 'pending')).toBe(true);
    expect(canTransitionChainBreak('claimed', 'resolved')).toBe(true);
    expect(canTransitionChainBreak('claimed', 'dismissed')).toBe(true);
  });

  it('forbids pending → resolved (must claim first)', () => {
    expect(canTransitionChainBreak('pending', 'resolved')).toBe(false);
    expect(canTransitionChainBreak('pending', 'dismissed')).toBe(false);
  });

  it('forbids re-claiming an already-claimed break', () => {
    expect(canTransitionChainBreak('claimed', 'claimed')).toBe(false);
  });

  it('forbids any transition out of terminal states', () => {
    expect(validChainBreakTransitions('resolved')).toEqual([]);
    expect(validChainBreakTransitions('dismissed')).toEqual([]);
    expect(canTransitionChainBreak('resolved', 'pending')).toBe(false);
    expect(canTransitionChainBreak('dismissed', 'claimed')).toBe(false);
  });

  it('lists valid transitions from pending and claimed', () => {
    expect(validChainBreakTransitions('pending')).toEqual(['claimed']);
    expect(validChainBreakTransitions('claimed')).toEqual(['pending', 'resolved', 'dismissed']);
  });

  it('classifies terminal states', () => {
    expect(isTerminalChainBreak('resolved')).toBe(true);
    expect(isTerminalChainBreak('dismissed')).toBe(true);
    expect(isTerminalChainBreak('pending')).toBe(false);
    expect(isTerminalChainBreak('claimed')).toBe(false);
  });
});

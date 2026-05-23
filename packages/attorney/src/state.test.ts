import { describe, expect, it } from 'vitest';

import { canTransition, isTerminal, validTransitions } from './state';

describe('canTransition', () => {
  it('allows pending → claimed', () => {
    expect(canTransition('pending', 'claimed')).toBe(true);
  });
  it('allows claimed → approved', () => {
    expect(canTransition('claimed', 'approved')).toBe(true);
  });
  it('allows claimed → rejected', () => {
    expect(canTransition('claimed', 'rejected')).toBe(true);
  });
  it('allows claimed → pending (unclaim)', () => {
    expect(canTransition('claimed', 'pending')).toBe(true);
  });
  it('forbids approved → anything', () => {
    expect(canTransition('approved', 'pending')).toBe(false);
    expect(canTransition('approved', 'claimed')).toBe(false);
  });
  it('forbids rejected → anything', () => {
    expect(canTransition('rejected', 'pending')).toBe(false);
  });
  it('forbids pending → approved (must claim first)', () => {
    expect(canTransition('pending', 'approved')).toBe(false);
  });
});

describe('validTransitions', () => {
  it('returns reachable states from pending', () => {
    expect(validTransitions('pending')).toEqual(['claimed']);
  });
  it('returns reachable states from claimed', () => {
    expect(validTransitions('claimed').sort()).toEqual(['approved', 'pending', 'rejected']);
  });
  it('returns [] from terminal states', () => {
    expect(validTransitions('approved')).toEqual([]);
    expect(validTransitions('rejected')).toEqual([]);
  });
});

describe('isTerminal', () => {
  it('approved + rejected are terminal', () => {
    expect(isTerminal('approved')).toBe(true);
    expect(isTerminal('rejected')).toBe(true);
  });
  it('pending + claimed are not terminal', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('claimed')).toBe(false);
  });
});

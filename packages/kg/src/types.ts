import type { DbOrTx } from '@cema/db';

export type NodeType = 'contact' | 'party' | 'deal' | 'document' | 'communication';

export type Predicate =
  | 'contact_is_party' // contact → party  (same person, different representations)
  | 'party_is_on_deal' // party → deal     (exists via parties.deal_id but also stored as edge)
  | 'deal_has_document' // deal → document
  | 'deal_has_instrument' // deal → document (an IDP-classified collateral instrument)
  | 'chain_precedes' // document → document (recorded assignment-sequence adjacency)
  | 'deal_has_communication'; // deal → communication

export interface AddEdgeInput {
  organizationId: string;
  subjectId: string;
  subjectType: NodeType;
  predicate: Predicate;
  objectId: string;
  objectType: NodeType;
  metadata?: Record<string, unknown>;
}

export interface RemoveEdgeInput {
  organizationId: string;
  subjectId: string;
  subjectType: NodeType;
  predicate: Predicate;
  objectId: string;
  objectType: NodeType;
}

export interface FindNeighborsInput {
  organizationId: string;
  nodeId: string;
  nodeType: NodeType;
  predicate?: Predicate;
  direction?: 'outbound' | 'inbound' | 'both';
}

export interface NeighborNode {
  nodeId: string;
  nodeType: NodeType;
  predicate: Predicate;
}

export interface TraverseInput {
  organizationId: string;
  startId: string;
  startType: NodeType;
  maxDepth?: number;
  predicates?: Predicate[];
}

export interface TraversalNode {
  nodeId: string;
  nodeType: NodeType;
  depth: number;
  pathFrom: string;
}

export type { DbOrTx };

import { kgEdges } from '@cema/db';
import { and, eq, or, sql } from 'drizzle-orm';

import type {
  AddEdgeInput,
  DbOrTx,
  FindNeighborsInput,
  NeighborNode,
  NodeType,
  Predicate,
  RemoveEdgeInput,
  TraverseInput,
  TraversalNode,
} from './types';

export async function addEdge(tx: DbOrTx, input: AddEdgeInput): Promise<void> {
  await tx
    .insert(kgEdges)
    .values({
      organizationId: input.organizationId,
      subjectId: input.subjectId,
      subjectType: input.subjectType,
      predicate: input.predicate,
      objectId: input.objectId,
      objectType: input.objectType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    })
    .onConflictDoNothing();
}

export async function removeEdge(tx: DbOrTx, input: RemoveEdgeInput): Promise<void> {
  await tx
    .delete(kgEdges)
    .where(
      and(
        eq(kgEdges.organizationId, input.organizationId),
        eq(kgEdges.subjectId, input.subjectId),
        eq(kgEdges.subjectType, input.subjectType),
        eq(kgEdges.predicate, input.predicate),
        eq(kgEdges.objectId, input.objectId),
        eq(kgEdges.objectType, input.objectType),
      ),
    );
}

export async function findNeighbors(
  tx: DbOrTx,
  input: FindNeighborsInput,
): Promise<NeighborNode[]> {
  const direction = input.direction ?? 'outbound';

  const outbound =
    direction === 'outbound' || direction === 'both'
      ? and(
          eq(kgEdges.organizationId, input.organizationId),
          eq(kgEdges.subjectId, input.nodeId),
          eq(kgEdges.subjectType, input.nodeType),
          ...(input.predicate ? [eq(kgEdges.predicate, input.predicate)] : []),
        )
      : undefined;

  const inbound =
    direction === 'inbound' || direction === 'both'
      ? and(
          eq(kgEdges.organizationId, input.organizationId),
          eq(kgEdges.objectId, input.nodeId),
          eq(kgEdges.objectType, input.nodeType),
          ...(input.predicate ? [eq(kgEdges.predicate, input.predicate)] : []),
        )
      : undefined;

  const condition = outbound && inbound ? or(outbound, inbound) : (outbound ?? inbound)!;

  const rows = await tx.select().from(kgEdges).where(condition);

  return rows.map((r) => {
    if (direction === 'inbound') {
      return {
        nodeId: r.subjectId,
        nodeType: r.subjectType as NodeType,
        predicate: r.predicate as Predicate,
      };
    }
    return {
      nodeId: r.objectId,
      nodeType: r.objectType as NodeType,
      predicate: r.predicate as Predicate,
    };
  });
}

export async function traverse(tx: DbOrTx, input: TraverseInput): Promise<TraversalNode[]> {
  const maxDepth = input.maxDepth ?? 5;
  const predicateFilter = input.predicates?.length
    ? sql`AND predicate = ANY(ARRAY[${sql.join(
        input.predicates.map((p) => sql`${p}`),
        sql`, `,
      )}])`
    : sql``;

  const result = await tx.execute<{
    node_id: string;
    node_type: string;
    depth: number;
    path_from: string;
  }>(sql`
    WITH RECURSIVE kg_traverse AS (
      SELECT
        object_id     AS node_id,
        object_type   AS node_type,
        1             AS depth,
        subject_id    AS path_from
      FROM kg_edges
      WHERE
        organization_id = ${input.organizationId}::uuid
        AND subject_id   = ${input.startId}::uuid
        AND subject_type = ${input.startType}
        ${predicateFilter}

      UNION ALL

      SELECT
        e.object_id,
        e.object_type,
        t.depth + 1,
        t.node_id
      FROM kg_edges e
      INNER JOIN kg_traverse t ON e.subject_id = t.node_id AND e.subject_type = t.node_type
      WHERE
        e.organization_id = ${input.organizationId}::uuid
        AND t.depth < ${maxDepth}
        ${predicateFilter}
    )
    SELECT DISTINCT node_id, node_type, depth, path_from
    FROM kg_traverse
    ORDER BY depth, node_id
  `);

  return result.rows.map((r) => ({
    nodeId: r.node_id,
    nodeType: r.node_type as NodeType,
    depth: r.depth,
    pathFrom: r.path_from,
  }));
}

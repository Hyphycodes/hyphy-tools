import type { TableName } from './seed';

/**
 * Demo Mode's memory: the visitor's own changes, layered over the seed.
 */
export type JournalOp =
  | { k: 'add'; t: TableName; row: Record<string, unknown>; by: string; at: string }
  | { k: 'set'; t: TableName; id: string; patch: Record<string, unknown>; by: string; at: string }
  /** Only files are deleted: an upload that didn't finish, or one deleted from Trash. */
  | { k: 'del'; t: TableName; id: string; by: string; at: string };

/** A change before it's stamped with who made it and when. */
export type PendingOp = JournalOp extends infer Op
  ? Op extends JournalOp
    ? Omit<Op, 'by' | 'at'>
    : never
  : never;

import { z } from "zod";

/** VM/template/name identifier: non-empty, bounded, must not start with "-". */
export const boundedName = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^-]/, 'must not start with "-"');

/** Controller templateId, instance_id, tag, and similar opaque ids. */
export const uuidLike = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/);

/** Optional bounded label or external reference. */
export const optionalBoundedString = z.string().trim().min(1).max(512);

/** Local start_vm wait timeout in seconds. */
export const timeoutSecondsSchema = z.number().positive().max(3600);

import { z } from "zod";

export const PolicySchema = z.object({
  id: z.string(),
  description: z.string(),
  tool: z.string().optional(),
  createdAt: z.string(),
});

export const PoliciesFileSchema = z.object({
  policies: z.array(PolicySchema).default([]),
});

export type Policy = z.infer<typeof PolicySchema>;
export type PoliciesFile = z.infer<typeof PoliciesFileSchema>;

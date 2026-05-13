import { z } from 'zod';

export const createDealInputSchema = z.object({
  cemaType: z.enum(['refi_cema', 'purchase_cema']),
  propertyType: z.enum(['one_family', 'two_family', 'three_family', 'condo', 'pud']),
  streetAddress: z.string().min(1),
  unit: z.string().optional(),
  city: z.string().min(1),
  county: z.string().min(1),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  principal: z.string().regex(/^\d+(\.\d{1,2})?$/),
  program: z.enum(['conventional_fannie', 'conventional_freddie', 'conventional_private', 'jumbo']),
  upb: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

export type CreateDealInput = z.infer<typeof createDealInputSchema>;

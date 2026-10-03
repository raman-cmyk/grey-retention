import { z } from 'zod'
export function validateDesignBytes(bytes: Uint8Array, name: string) {
  if (bytes.length < 12 || bytes.length > 10 * 1024 * 1024)
    throw new Error('Use a PNG, JPEG or WebP file between 12 bytes and 10 MiB.')
  let mediaType: string
  let extension: string
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    mediaType = 'image/png'
    extension = 'png'
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    mediaType = 'image/jpeg'
    extension = 'jpg'
  } else if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    mediaType = 'image/webp'
    extension = 'webp'
  } else
    throw new Error(
      'File signature must be PNG, JPEG or WebP. SVG, HTML and archives are unavailable for design submission.'
    )
  const allowed =
    mediaType === 'image/jpeg'
      ? /\.jpe?g$/i
      : mediaType === 'image/png'
        ? /\.png$/i
        : /\.webp$/i
  if (!allowed.test(name))
    throw new Error('File extension does not match its image signature.')
  return { mediaType, extension }
}
export const assignmentBriefSchema = z.object({
  brief: z.object({
    title: z.string(),
    subject: z.string(),
    preheader: z.string(),
    body: z.string(),
    cta: z.string(),
    url: z.string(),
    brandName: z.string(),
    voice: z.string(),
    prohibitions: z.string(),
    referenceStructure: z.string(),
    copyRevision: z.number(),
    assetPaths: z.array(z.string()),
    brandRevision: z.number().optional(),
    sequenceBrief: z.string().nullable().optional(),
    kit: z
      .object({
        revision: z.number(),
        colors: z.array(z.string()),
        fonts: z.array(z.string()),
        approved: z.boolean()
      })
      .nullable()
      .optional()
  }),
  tenantId: z.uuid(),
  campaignId: z.uuid(),
  assignmentId: z.uuid(),
  state: z.string(),
  dueAt: z.string(),
  designRevision: z.number().int().positive(),
  stale: z.boolean()
})

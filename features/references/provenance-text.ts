/** Plain description of how a draft relates to the email it started from. */
export function provenanceSentence(
  mode: 'copy' | 'rewrite' | undefined,
  structure: string[]
) {
  if (mode === 'copy')
    return 'This campaign is an exact copy of the email you added. Edit it on its email page before you approve it.'
  if (mode === 'rewrite')
    return 'This campaign rewrites the email you added for your brand. Check the result on its email page before you approve it.'
  const outline = structure.filter((part) => part.trim() !== '')
  return outline.length
    ? `This draft follows the outline of the email you added: ${outline.join(' · ')}. Its wording, images, links and offers were not copied.`
    : 'This draft started from the email you added. Its wording, images, links and offers were not copied.'
}

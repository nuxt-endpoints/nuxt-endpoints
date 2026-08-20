// Server-driven media type selection for a response declared with more than
// one `media` entry. The mirror image of request-side selection in
// body-media-type.ts: that one reads `Content-Type` and answers 415, this one
// reads `Accept` and answers 406.
//
// Kept as a standalone module with no runtime imports so the selection rules
// can be tested directly against the header strings that produce them.

type AcceptRange = {
  type: string
  subtype: string
  quality: number
  /** 2 for `type/subtype`, 1 for `type/*`, 0 for the fully wild range. */
  specificity: number
}

/**
 * Picks which of `offered` to send for an `Accept` header, or `undefined` when
 * the client accepts none of them - the caller's cue to answer 406.
 *
 * `offered` is the endpoint's own declaration order, which doubles as its
 * preference: it decides ties, and it decides outright when the request
 * expresses no preference - an absent header, or a fully wild range. A server
 * that offers
 * several representations has an opinion about which is best, and honoring it
 * is what makes omitting `accept` on the client a sensible default rather than
 * an arbitrary one.
 */
export function negotiateMediaType(
  header: string | null | undefined,
  offered: readonly string[],
): string | undefined {
  const candidates = offered
    .map((mediaType, index) => ({ index, essence: essence(mediaType) }))
    .filter((candidate) => candidate.essence.includes('/'))
  if (candidates.length === 0) {
    return undefined
  }

  const ranges = parseAcceptHeader(header)
  if (ranges === undefined) {
    return offered[candidates[0]!.index]
  }

  let best: { index: number; quality: number; specificity: number } | undefined
  for (const { index, essence: candidate } of candidates) {
    const match = bestMatchingRange(candidate, ranges)
    // A quality of zero is an explicit refusal, not a weak preference, so it
    // never becomes the answer even when nothing else matches.
    if (!match || match.quality === 0) {
      continue
    }
    if (
      !best ||
      match.quality > best.quality ||
      (match.quality === best.quality && match.specificity > best.specificity)
    ) {
      best = { index, quality: match.quality, specificity: match.specificity }
    }
  }

  return best ? offered[best.index] : undefined
}

/**
 * `undefined` when the request expresses no preference at all - an absent or
 * empty header, which HTTP treats as accepting anything. Distinguished from an
 * empty range list so the caller can fall back to its own preference instead
 * of answering 406.
 */
function parseAcceptHeader(header: string | null | undefined): AcceptRange[] | undefined {
  if (header === null || header === undefined || header.trim() === '') {
    return undefined
  }

  const ranges: AcceptRange[] = []
  for (const part of header.split(',')) {
    const range = parseAcceptRange(part)
    if (range) {
      ranges.push(range)
    }
  }
  // A header that parses to nothing at all is malformed, not restrictive. RFC
  // 9110 allows ignoring a malformed field, and ignoring it is kinder than
  // answering 406 to a client that did ask for something.
  return ranges.length > 0 ? ranges : undefined
}

function parseAcceptRange(part: string): AcceptRange | undefined {
  const segments = part.split(';')
  const [type, subtype] = essence(segments[0] ?? '').split('/')
  if (!type || !subtype) {
    return undefined
  }

  return {
    type,
    subtype,
    quality: parseQuality(segments.slice(1)),
    specificity: type === '*' ? 0 : subtype === '*' ? 1 : 2,
  }
}

// A malformed or out-of-range `q` is treated as absent rather than as zero:
// dropping a representation the client did ask for is the worse failure.
function parseQuality(parameters: readonly string[]): number {
  for (const parameter of parameters) {
    const [name, value] = parameter.split('=')
    if (name?.trim().toLowerCase() !== 'q') {
      continue
    }
    const quality = Number.parseFloat(value ?? '')
    return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 1
  }
  return 1
}

function bestMatchingRange(
  candidate: string,
  ranges: readonly AcceptRange[],
): AcceptRange | undefined {
  const [type, subtype] = candidate.split('/')
  if (!type || !subtype) {
    return undefined
  }

  // The most specific matching range wins, per RFC 9110: `text/csv` overrides
  // a `text/*` that would otherwise apply, including when it lowers the
  // quality or refuses outright.
  let best: AcceptRange | undefined
  for (const range of ranges) {
    const matches =
      range.specificity === 0 ||
      (range.type === type && (range.specificity === 1 || range.subtype === subtype))
    if (!matches) {
      continue
    }
    if (!best || range.specificity > best.specificity) {
      best = range
    }
  }
  return best
}

/** The media type without its parameters, lowercased for comparison. */
function essence(mediaType: string): string {
  return mediaType.split(';')[0]!.trim().toLowerCase()
}

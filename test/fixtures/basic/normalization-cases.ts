export const normalizationCases = [
  ['/normalized/について', '/normalized/%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6'],
  ['/normalized/hello world', '/normalized/hello%20world'],
  ['/normalized/%40handle', '/normalized/@handle'],
  ['/normalized/%61dmin', '/normalized/admin'],
  ['/normalized/a/./b', '/normalized/a/b'],
  ['/normalized/a/b/../c', '/normalized/a/c'],
  ['/normalized/a/%2e%2e/d', '/normalized/d'],
  ['/normalized/a%2Fb', '/normalized/a%2Fb'],
  ['/normalized/a%25b', '/normalized/a%25b'],
  ['/normalized/trailing/', '/normalized/trailing/'],
  ['/normalized/%27quote', "/normalized/'quote"],
] as const

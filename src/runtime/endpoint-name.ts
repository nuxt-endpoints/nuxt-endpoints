export const reservedEndpointNameList = [
  '__proto__',
  'arguments',
  'caller',
  'constructor',
  'length',
  'name',
  'prototype',
  'then',
  'apply',
  'bind',
  'call',
  'catch',
  'finally',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
] as const

export type ReservedEndpointName = (typeof reservedEndpointNameList)[number]

const reservedEndpointNames = new Set<string>(reservedEndpointNameList)
const endpointNamePattern = /^[$A-Z_a-z][$\w]*$/u

export function isValidEndpointName(name: string): boolean {
  return endpointNamePattern.test(name)
}

export function isReservedEndpointName(name: string): boolean {
  return reservedEndpointNames.has(name)
}

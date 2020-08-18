interface CaptureKey<I, O> {
  __internal: {
    invariantInput: (t: I) => I
    invariantOutput: (t: O) => O
  }
}

export interface Capture<I, O> {
  input: I
  output: ValidationResult<O>
}

export function createCaptureKey<I, O>() {
  return {} as CaptureKey<I, O>
}

class CaptureSet {
  overloadedKeys: Set<CaptureKey<any, any>> = new Set()
  definedKeys: Map<CaptureKey<any, any>, Capture<any, any>> = new Map()

  add<I, O>(key: CaptureKey<I, O>, io: Capture<I, O>) {
    if (this.overloadedKeys.has(key)) {
      return
    } else if (this.definedKeys.has(key)) {
      this.definedKeys.delete(key)
      this.overloadedKeys.add(key)
    } else {
      this.definedKeys.set(key, io)
    }
  }

  get<I, O>(key: CaptureKey<I, O>): undefined | Capture<I, O> {
    return this.definedKeys.get(key)
  }

  constructor(captureSets: CaptureSet[]) {
    for (const { definedKeys, overloadedKeys } of captureSets) {
      for (const key of overloadedKeys) {
        this.overloadedKeys.add(key)
      }
      for (const [key, value] of definedKeys.entries()) {
        this.add(key, value)
      }
    }
  }
}

interface Transform {
  <I, O>(
    input: I,
    binding: (input: I, transform: Transform) => ValidationResult<O>,
  ): ValidationResult<O>
}

export interface Transformer<I, O> {
  (input: I, transform: Transform): ValidationResult<O>
}

export function capture<I, O>(
  key: CaptureKey<I, O>,
  transformer: Transformer<I, O>,
): Transformer<I, O> {
  return (input, transform) => {
    const output = transform(input, transformer)
    const captures = new CaptureSet([])

    captures.add(key, { input, output })

    return output.bind(value => valid(value, undefined, [captures]))
  }
}

export type ValidationResult<T> = Valid<T> | Invalid<T> | Failure<T>

// TODO: think about perf
// making this a lazy op would probably help perf a lot
function crossProductCaptures(captures: CaptureSet[][]): CaptureSet[] {
  if (captures.length === 0) {
    throw new Error(
      'cross product is undefined when no CaptureSet arrays are provided',
    )
  }
  if (captures.length === 1) {
    return captures[0]
  }
  const [foos, ...rest] = captures
  const bars = crossProductCaptures(rest)
  if (foos.length === 0) {
    return bars
  }
  return flatMap(foos, foo => bars.map(bar => new CaptureSet([foo, bar])))
}

function just<T>(t: T | undefined | null): t is T {
  return t !== null && t !== undefined
}

abstract class __ValidationResult__<T> {
  // TODO: make abstract
  bind<U>(binding: (t: T) => ValidationResult<U>): ValidationResult<U> {
    const self = this
    if (self instanceof Failure) {
      return self
    }
    if (!(self instanceof Valid || self instanceof Invalid)) {
      return failure('unrecognized validation result type')
    }
    const result = binding(self.value)
    const warnings = [...self.warnings, ...result.warnings]
    const errors = [...(self.errors || []), ...(result.errors || [])]
    if (result instanceof Failure) {
      return failure(errors, warnings)
    }
    const captures = crossProductCaptures([self.captures, result.captures])
    if (errors.length) {
      return invalid(result.value, errors, warnings, captures)
    } else {
      return valid(result.value, warnings, captures)
    }
  }
  abstract get<I, O>(key: CaptureKey<I, O>): Array<undefined | Capture<I, O>>
  getCanonical<I, O>(key: CaptureKey<I, O>): undefined | Capture<I, O> {
    const rawValues = new Set(this.get(key).filter(just))
    if (rawValues.size === 1) {
      const [rawValue] = rawValues
      return rawValue
    }
    return undefined
  }
  // TODO: groupBy
}

class Valid<T> extends __ValidationResult__<T> {
  value: T
  errors?: undefined
  warnings: string[]
  captures: CaptureSet[]

  constructor(value: T, warnings: string[], captures: CaptureSet[]) {
    super()
    this.value = value
    this.warnings = warnings
    this.captures = captures
  }

  get<I, O>(key: CaptureKey<I, O>) {
    return this.captures.map(captureSet => captureSet.get(key))
  }
}

export function valid<T>(
  value: T,
  warnings: string | string[] = [],
  captures: CaptureSet[] = [new CaptureSet([])],
) {
  return new Valid(
    value,
    typeof warnings === 'string' ? [warnings] : warnings,
    captures,
  )
}

class Invalid<T> extends __ValidationResult__<T> {
  value: T
  errors: string[]
  warnings: string[]
  captures: CaptureSet[]

  constructor(
    value: T,
    errors: string[],
    warnings: string[],
    captures: CaptureSet[],
  ) {
    super()
    this.value = value
    this.errors = errors
    this.warnings = warnings
    this.captures = captures
  }

  get<I, O>(key: CaptureKey<I, O>) {
    return this.captures.map(captureSet => captureSet.get(key))
  }
}

export function invalid<T>(
  value: T,
  errors: string | string[] = [],
  warnings: string | string[] = [],
  captures: CaptureSet[] = [new CaptureSet([])],
) {
  return new Invalid(
    value,
    typeof errors === 'string' ? [errors] : errors,
    typeof warnings === 'string' ? [warnings] : warnings,
    captures,
  )
}

class Failure<T = any> extends __ValidationResult__<T> {
  value: undefined
  // TODO: are strings good enough?
  errors: string[]
  warnings: string[]
  // TODO: should captures be allowed in failures?
  captures?: undefined

  constructor(errors: string[], warnings: string[]) {
    super()
    this.errors = errors
    this.warnings = warnings
  }

  get<I, O>(__key: CaptureKey<I, O>): Array<undefined | Capture<I, O>> {
    return []
  }
}

export function failure(
  errors: string | string[],
  warnings: string | string[] = [],
) {
  return new Failure(
    typeof errors === 'string' ? [errors] : errors,
    typeof warnings === 'string' ? [warnings] : warnings,
  )
}

function flatMap<T, U>(arr: T[], fn: (t: T) => U[]): U[] {
  return Array.prototype.concat.apply([], arr.map(fn))
}

const productionContext = new WeakMap<
  ValidationResult<any>,
  Transformer<any, any>
>()

class MultiMap<K, V> {
  map = new Map<K, V[]>()
  get(key: K) {
    let values = this.map.get(key)
    if (values === undefined) {
      values = []
      this.map.set(key, values)
    }
    return values
  }
  add(key: K, values: V[]) {
    this.get(key).push(...values)
  }
}

export function mergeResults<Results extends ValidationResult<any>[], Foo>(
  results: Results,
  mapping: (
    inputs: {
      [I in keyof Results]: Results[I] extends ValidationResult<infer T>
        ? T
        : never
    },
  ) => ValidationResult<Foo>,
): ValidationResult<Foo> {
  const warnings = flatMap(results, result => result.warnings)
  const errors = flatMap(results, result => result.errors || [])

  const values = []
  const allCaptures = new MultiMap<unknown, CaptureSet>()
  for (const result of results) {
    if (result instanceof Failure) {
      break
    } else {
      values.push(result.value)
      allCaptures.add(productionContext.get(result), result.captures)
    }
  }
  const captures = crossProductCaptures([...allCaptures.map.values()])

  if (values.length === results.length) {
    const value = mapping(values as any)
    if (value instanceof Failure) {
      return failure(
        [...value.errors, ...errors],
        [...value.warnings, ...warnings],
      )
    } else if (errors.length) {
      return value.bind(foo => invalid(foo, errors, warnings, captures))
    } else {
      return value.bind(foo => valid(foo, warnings, captures))
    }
  } else {
    return failure(errors, warnings)
  }
}

function __transform__<I, O>(
  input: I,
  transformer: Transformer<I, O>,
): ValidationResult<O> {
  const cache = new WeakMap<
    Transformer<any, any>,
    Map<unknown, ValidationResult<any>>
  >()

  function transform<I, O>(i: I, t: Transformer<I, O>): ValidationResult<O> {
    // memo by weak cache
    let foo = cache.get(t)
    if (foo) {
      const bar = foo.get(i)
      if (bar) {
        return bar
      }
    } else {
      foo = new Map()
      cache.set(t, foo)
    }

    const result = t(i, transform)
    productionContext.set(result, t)
    foo.set(i, result)
    return result
  }

  return transformer(input, transform)
}

export { __transform__ as transform }

// TODO: assert functions (as valid)
export function isValid<T>(x: ValidationResult<T>): x is Valid<T>
export function isValid(x: unknown): x is Valid<unknown> {
  return x && x instanceof Valid
}

export function isInvalid<T>(x: ValidationResult<T>): x is Invalid<T>
export function isInvalid<T>(x: unknown): x is Invalid<T> {
  return x && x instanceof Invalid
}

export function isFailure<T>(x: ValidationResult<T>): x is Failure<T>
export function isFailure(x: unknown): x is Failure {
  return x && x instanceof Failure
}

export function intersection<I>(
  ...transformers: Transformer<I, any>[]
): Transformer<I, I> {
  return function (input, transform) {
    return mergeResults(
      transformers.map(transformer => transform(input, transformer)),
      () => valid(input),
    )
  }
}

// eager/greedy/short-circuiting or
export function union<I, O>(
  ...transformers: Transformer<I, O>[]
): Transformer<I, O> {
  return function (input, transform) {
    let firstInvalid
    let firstFailure
    for (const transformer of transformers) {
      const result = transform(input, transformer)
      if (isValid(result)) {
        return result
      } else if (isInvalid(result)) {
        firstInvalid = firstInvalid || result
      } else if (isFailure(result)) {
        firstFailure = firstFailure || result
      }
    }
    return firstInvalid || firstFailure || failure('The impossible happened')
  }
}

export function chain<A, B, C>(
  a: Transformer<A, B>,
  b: Transformer<B, C>,
): Transformer<A, C>
export function chain<A, B, C, D>(
  a: Transformer<A, B>,
  b: Transformer<B, C>,
  c: Transformer<C, D>,
): Transformer<A, D>
export function chain<A, B, C, D, E>(
  a: Transformer<A, B>,
  b: Transformer<B, C>,
  c: Transformer<C, D>,
  d: Transformer<D, E>,
): Transformer<A, E>
export function chain<A, B, C, D, E, F>(
  a: Transformer<A, B>,
  b: Transformer<B, C>,
  c: Transformer<C, D>,
  d: Transformer<D, E>,
  e: Transformer<E, F>,
): Transformer<A, F>
export function chain(
  ...transformers: Transformer<any, any>[]
): Transformer<any, any> {
  const [first, ...rest] = transformers
  return function (input, transform) {
    const result = transform(input, first)
    return rest.reduce(
      (lastResult, transformer) =>
        lastResult.bind((lastValue: any) => transform(lastValue, transformer)),
      result,
    )
  }
}

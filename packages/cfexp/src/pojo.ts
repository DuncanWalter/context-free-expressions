/**
 * context free expression combinators for pojos
 */

import { Transformer, mergeResults, valid, invalid, failure, chain } from '.'

type ObjectPattern = {
  [prop: string]: Transformer<unknown, any>
}

type ObjectPatternResult<P extends ObjectPattern> = {
  [Prop in keyof P]: P[Prop] extends Transformer<any, infer T> ? T : never
}

type ArrayPattern = {
  [prop: string]: Transformer<unknown, any>
} & any[]

type ArrayPatternResult<P extends ArrayPattern> = {
  [Prop in keyof P]: P[Prop] extends Transformer<any, infer T> ? T : never
}

export function constant<
  T extends string | number | boolean | null | undefined
>(value: T): Transformer<unknown, T> {
  return function (input) {
    if (input === value) {
      return valid(input as T)
    } else if (typeof input === typeof value) {
      return invalid(
        input as T,
        `Received input with value '${input}' where '${value}' was expected`,
      )
    } else {
      return failure(
        `Received input of type '${typeof input}' where '${typeof value}' was expected`,
      )
    }
  }
}

const primitiveTypesByConstructor = new Map<unknown, string>([
  [Number, 'number'],
  [String, 'string'],
  [Boolean, 'boolean'],
])

interface Constructor<T> {
  new (args: any[]): T
}

export function instance(
  constructor: typeof Number,
): Transformer<unknown, number>
export function instance(
  constructor: typeof Boolean,
): Transformer<unknown, boolean>
export function instance(
  constructor: typeof String,
): Transformer<unknown, string>
export function instance(
  constructor: typeof Object,
): Transformer<unknown, object>
export function instance(
  constructor: typeof Array,
): Transformer<unknown, unknown[]>
export function instance<T>(
  constructor: Constructor<T>,
): Transformer<unknown, T>
export function instance(constructor: Function): Transformer<unknown, unknown> {
  const type = primitiveTypesByConstructor.get(constructor)
  if (type) {
    return function (input) {
      if (typeof input === type) {
        return valid(input)
      } else {
        return failure(
          `Received input of type '${typeof input}' where '${type}' was expected`,
        )
      }
    }
  } else {
    return function (input) {
      if (input instanceof constructor) {
        return valid(input)
      } else {
        return failure(
          `Received input was not an instance of ${constructor.name} `,
        )
      }
    }
  }
}

export function objectShape<P extends ObjectPattern>(
  pattern: P,
): Transformer<unknown, ObjectPatternResult<P>> {
  return chain(instance(Object), (obj, transform) => {
    const keys = Object.keys(pattern) as Array<keyof P>
    return mergeResults(
      keys.map(key =>
        transform((obj as Record<keyof P, unknown>)[key], pattern[key]),
      ),
      values => {
        const result = {} as ObjectPatternResult<P>
        values.forEach((value, i) => {
          result[keys[i]] = value
        })
        return valid(result)
      },
    )
  })
}

export function objectCollection<O>(
  transformer: Transformer<unknown, O>,
): Transformer<unknown, Record<string, O>> {
  return chain(instance(Object), (obj, transform) => {
    const keys = Object.keys(obj) as Array<keyof typeof obj>
    return mergeResults(
      keys.map(key => transform(obj[key], transformer)),
      values => {
        const result = {} as Record<string, O>
        for (const i in values) {
          result[keys[i]] = values[i]
        }
        return valid(result)
      },
    )
  })
}

export function arrayShape<P extends ArrayPattern>(
  pattern: P,
): Transformer<unknown, ArrayPatternResult<P>> {
  return chain(instance(Array), (arr, transform) => {
    if (arr.length !== pattern.length) {
      return failure(
        `Received input of length ${arr.length} where length ${pattern.length} was expected`,
      )
    }
    return mergeResults(
      arr.map((_, i, a) => transform(a[i], pattern[i])),
      values => valid(values),
    )
  })
}

export function arrayCollection<O>(
  transformer: Transformer<unknown, O>,
): Transformer<unknown, O[]> {
  return chain(instance(Array), (arr, transform) =>
    mergeResults(
      arr.map(elem => transform(elem, transformer)),
      values => valid(values),
    ),
  )
}

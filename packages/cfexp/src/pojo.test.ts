import { objectShape, instance, constant, arrayCollection } from './pojo'
import { transform, valid, createCaptureKey, capture, chain } from '.'

const info = createCaptureKey<unknown, boolean>()
const numeric = createCaptureKey<unknown, number>()

const arbitrary = objectShape({
  green: instance(String),
  blue: arrayCollection(capture(numeric, constant(4))),
  red: objectShape({
    crimson: capture(info, constant(true)),
    brick: chain(
      instance(Number),
      n => valid(n * 10),
      n => valid(`${n}`),
    ),
  }),
})

test('foo', () => {
  const foo = transform(
    {
      green: 'green',
      blue: [4, 4, 5],
      red: {
        crimson: true,
        brick: 5,
      },
    },
    arbitrary,
  )
  console.log(foo)
  console.log(foo.get(info))
  console.log(foo.get(numeric))
  console.log(foo.getCanonical(info))
})

import * as v from 'valibot';

type OptionalState =
  | { enabled: false }
  | { enabled: true; hasDefault: false }
  | { enabled: true; hasDefault: true; value: unknown };

export type SchemaShape = Record<string, SchemaBuilder>;

export class SchemaBuilder {
  readonly shape?: SchemaShape;
  readonly #makeBase: () => v.GenericSchema;
  readonly #actions: unknown[];
  readonly #optional: OptionalState;

  constructor(
    makeBase: () => v.GenericSchema,
    options?: {
      shape?: SchemaShape;
      actions?: unknown[];
      optional?: OptionalState;
    },
  ) {
    this.#makeBase = makeBase;
    this.shape = options?.shape;
    this.#actions = options?.actions ?? [];
    this.#optional = options?.optional ?? { enabled: false };
  }

  build(): v.GenericSchema {
    let schema = this.#makeBase();
    if (this.#actions.length > 0) {
      schema = v.pipe(schema as never, ...(this.#actions as never));
    }
    if (!this.#optional.enabled) {
      return schema;
    }
    if (!this.#optional.hasDefault) {
      return v.optional(schema as never);
    }
    return v.optional(schema as never, this.#optional.value as never);
  }

  safeParse(input: unknown) {
    return v.safeParse(this.build() as never, input);
  }

  describe(text: string): SchemaBuilder {
    return new SchemaBuilder(this.#makeBase, {
      shape: this.shape,
      actions: [...this.#actions, v.description(text)],
      optional: this.#optional,
    });
  }

  optional(): SchemaBuilder {
    return new SchemaBuilder(this.#makeBase, {
      shape: this.shape,
      actions: this.#actions,
      optional: { enabled: true, hasDefault: false },
    });
  }

  default(value: unknown): SchemaBuilder {
    return new SchemaBuilder(this.#makeBase, {
      shape: this.shape,
      actions: this.#actions,
      optional: { enabled: true, hasDefault: true, value },
    });
  }

  int(): SchemaBuilder {
    return new SchemaBuilder(this.#makeBase, {
      shape: this.shape,
      actions: [...this.#actions, v.integer()],
      optional: this.#optional,
    });
  }

  min(value: number): SchemaBuilder {
    return new SchemaBuilder(this.#makeBase, {
      shape: this.shape,
      actions: [...this.#actions, v.minValue(value)],
      optional: this.#optional,
    });
  }
}

function buildShape(shape: SchemaShape): Record<string, v.GenericSchema> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, schema]) => [key, schema.build()]),
  );
}

export function buildObjectSchema(shape: SchemaShape): v.GenericSchema {
  return v.object(buildShape(shape) as never);
}

export const schema = {
  string(): SchemaBuilder {
    return new SchemaBuilder(() => v.string());
  },

  number(): SchemaBuilder {
    return new SchemaBuilder(() => v.number());
  },

  boolean(): SchemaBuilder {
    return new SchemaBuilder(() => v.boolean());
  },

  literal(value: string): SchemaBuilder {
    return new SchemaBuilder(() => v.literal(value));
  },

  enum<const TValues extends readonly [string, ...string[]]>(values: TValues): SchemaBuilder {
    return new SchemaBuilder(() => v.picklist(values as never));
  },

  object(shape: SchemaShape): SchemaBuilder {
    return new SchemaBuilder(() => buildObjectSchema(shape), { shape });
  },

  array(item: SchemaBuilder): SchemaBuilder {
    return new SchemaBuilder(() => v.array(item.build() as never));
  },

  discriminatedUnion(key: string, options: SchemaBuilder[]): SchemaBuilder {
    return new SchemaBuilder(() => v.variant(key, options.map((option) => option.build()) as never));
  },
};

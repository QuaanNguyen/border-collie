export const petRpc = {
  id: 'bordercollie.pet',
  methods: {
    configuration: {
      input: { type: 'object', additionalProperties: false },
      output: {
        type: 'object',
        properties: { scale: { type: 'number' } },
        required: ['scale'],
        additionalProperties: false,
      },
    },
  },
  events: {
    event: { schema: { type: 'object', additionalProperties: true } },
  },
};

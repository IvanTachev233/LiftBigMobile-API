import { ValidateBy, ValidationOptions } from 'class-validator';

// Fails whenever the property is present, null included. The global
// ValidationPipe strips unknown properties instead of rejecting them, so
// fields a caller must not send are declared with this to get a 400.
export function Forbidden(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'forbidden',
      validator: {
        validate: (value: unknown) => value === undefined,
        defaultMessage: () => '$property is not allowed',
      },
    },
    validationOptions,
  );
}

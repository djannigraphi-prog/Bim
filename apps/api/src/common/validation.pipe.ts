import { ValidationError, ValidationPipe } from '@nestjs/common';
import { Errors } from './errors';

function flatten(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(out, flatten(e.children, path));
  }
  return out;
}

/** Rejette les champs inconnus : le client ne peut pas injecter de propriété que l'API n'attend pas. */
export const appValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => Errors.validation({ fields: flatten(errors) }),
});

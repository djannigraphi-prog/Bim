import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { STEP_UP_SCOPES } from './auth.decorators';

/** Inscription — champs du questionnaire Q13 et des écrans 04-05. */
export class RegisterDto {
  @ApiProperty({ example: 'Doho Yannick' }) @IsString() @Length(1, 120) fullName!: string;
  @ApiProperty({ example: 'yannick.doho', description: 'Sans « @ » ; 3 à 30 caractères : lettres, chiffres, point, tiret bas' })
  @IsString()
  @Length(3, 31)
  username!: string;
  @ApiProperty({ example: '1998-03-12', description: 'AAAA-MM-JJ ; privée par défaut' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La date doit être au format AAAA-MM-JJ.' })
  birthDate!: string;
  @ApiProperty({ example: 'Cocody' }) @IsString() @Length(1, 80) city!: string;
  @ApiPropertyOptional({ example: '+2250700000000', description: 'Téléphone ou e-mail : au moins un des deux (F16)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
  @ApiPropertyOptional({ example: 'nom@exemple.com' }) @IsOptional() @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional({ enum: ['female', 'male', 'undisclosed'] }) @IsOptional() @IsIn(['female', 'male', 'undisclosed']) gender?: 'female' | 'male' | 'undisclosed';
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @ApiProperty({ type: [String], example: ['mode', 'sport_coaching', 'coiffure'] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  interests!: string[];
}

export class VerifyCodeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
  @ApiProperty({ example: '123456' }) @IsString() @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres.' }) code!: string;
  @ApiPropertyOptional({ example: 'iPhone de Yannick' }) @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
}

export class ChallengeRefDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'yannick.doho', description: 'E-mail, téléphone ou nom d’utilisateur' }) @IsString() @Length(3, 254) identifier!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @Length(20, 200) refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ description: 'E-mail, téléphone ou nom d’utilisateur' }) @IsString() @Length(3, 254) identifier!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
  @ApiProperty() @IsString() @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres.' }) code!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class StepUpStartDto {
  @ApiProperty({ enum: STEP_UP_SCOPES }) @IsIn([...STEP_UP_SCOPES]) scope!: (typeof STEP_UP_SCOPES)[number];
  @ApiPropertyOptional({ description: 'Obligatoire si le compte a un mot de passe' }) @IsOptional() @IsString() @MaxLength(128) password?: string;
}

export class SwitchSpaceDto {
  @ApiProperty({ enum: ['user', 'merchant', 'courier'] }) @IsIn(['user', 'merchant', 'courier']) type!: 'user' | 'merchant' | 'courier';
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}

export class AddContactDto {
  @ApiProperty({ enum: ['phone', 'email'] }) @IsIn(['phone', 'email']) type!: 'phone' | 'email';
  @ApiProperty() @IsString() @Length(3, 254) value!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: ['system', 'light', 'dark'] }) @IsOptional() @IsIn(['system', 'light', 'dark']) theme?: 'system' | 'light' | 'dark';
}

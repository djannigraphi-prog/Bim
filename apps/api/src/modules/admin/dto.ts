import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdminLoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(1, 128) password!: string;
}

export class AdminLoginTokenDto {
  @ApiProperty() @IsString() @Length(10, 100) loginToken!: string;
}

export class AdminTotpDto extends AdminLoginTokenDto {
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres.' }) code!: string;
}

export class UpdateSettingDto {
  @ApiProperty({ description: 'Nouvelle valeur JSON (null = non décidé) ; contrôlée par setting-rules.ts' }) @Allow() value!: unknown;
  @ApiPropertyOptional({ enum: ['decided', 'provisional', 'pending'] }) @IsOptional() @IsIn(['decided', 'provisional', 'pending']) decisionStatus?: 'decided' | 'provisional' | 'pending';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) decisionRef?: string | null;
}

export class UserStatusDto {
  @ApiProperty({ enum: ['suspended', 'active'] }) @IsIn(['suspended', 'active']) status!: 'suspended' | 'active';
  @ApiProperty({ description: 'Motif, conservé dans le journal d’audit' }) @IsString() @Length(5, 300) reason!: string;
}

export class ProgramTaskDto {
  @ApiProperty() @IsString() @Length(2, 80) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) detail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @ApiProperty({ example: '07:00' }) @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, { message: "L'heure doit être au format HH:MM." }) timeOfDay!: string;
  @ApiProperty({ example: 127 }) @IsInt() @Min(1) @Max(127) weekdays!: number;
}

export class ProgramTipDto {
  @ApiPropertyOptional({ description: 'Jour de programme (1 = premier jour) ; vide = conseil général' }) @IsOptional() @IsInt() @Min(1) @Max(365) day?: number | null;
  @ApiProperty() @IsString() @Length(3, 240) text!: string;
}

export class ProgramDto {
  @ApiProperty() @IsString() @Length(1, 40) categoryCode!: string;
  @ApiPropertyOptional({ enum: ['any', 'eco', 'premium'], description: 'Mode de projet visé (C6) ; « any » = les deux' })
  @IsOptional()
  @IsIn(['any', 'eco', 'premium'])
  mode?: 'any' | 'eco' | 'premium';
  @ApiPropertyOptional({ type: [ProgramTipDto], description: 'Habitudes du jour (écran 27)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => ProgramTipDto)
  tips?: ProgramTipDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) goalCode?: string | null;
  @ApiProperty() @IsString() @Length(3, 120) title!: string;
  @ApiProperty() @IsInt() @Min(7) @Max(365) durationDays!: number;
  @ApiProperty({ type: [ProgramTaskDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ProgramTaskDto)
  tasks!: ProgramTaskDto[];
}

export class PublishProgramDto {
  @ApiProperty({ description: 'Nom et qualité de la personne compétente qui a validé le contenu (C7)', example: 'Awa Koné, coach sportive diplômée' })
  @IsString()
  @Length(5, 120)
  validatedBy!: string;
}

export class CreateAdminDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(2, 120) fullName!: string;
  @ApiProperty({ description: 'Mot de passe initial (12 caractères minimum), transmis hors de l’app' }) @IsString() @Length(12, 128) password!: string;
  @ApiProperty({ example: ['support'] }) @IsArray() @ArrayUnique() @IsString({ each: true }) roles!: string[];
}

export class UpdateAdminDto {
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) roles?: string[];
  @ApiPropertyOptional({ enum: ['active', 'disabled'] }) @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
  @ApiPropertyOptional({ description: 'Oblige à reconfigurer la double authentification (appareil perdu)' }) @IsOptional() @IsBoolean() resetTotp?: boolean;
}

export class CategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @ApiPropertyOptional({ example: '#FDECEF' }) @IsOptional() @IsString() @MaxLength(7) tint?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class GoalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) categoryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 60) label?: string;
  @ApiPropertyOptional({ example: 'kg' }) @IsOptional() @IsString() @MaxLength(12) quantityUnit?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() quantityMin?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() quantityMax?: number | null;
  @ApiPropertyOptional({ example: 'Perdre {q} kg' }) @IsOptional() @IsString() @MaxLength(80) titlePattern?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ResolveReportDto {
  @ApiProperty({ description: 'Réponse ou suite donnée (conservée)' }) @IsString() @Length(3, 500) resolution!: string;
}

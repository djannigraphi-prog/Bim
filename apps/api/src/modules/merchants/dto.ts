import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

/** Étape 1 : la boutique (nom, ville, commune, présentation). */
export class CreateApplicationDto {
  @ApiProperty({ example: 'Boutique Élégance' }) @IsString() @Length(2, 80) name!: string;
  @ApiProperty({ example: 'Abidjan' }) @IsString() @Length(2, 80) city!: string;
  @ApiPropertyOptional({ example: 'Cocody' }) @IsOptional() @IsString() @MaxLength(80) commune?: string;
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) commune?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional({ enum: ['cni', 'passport', 'permis'], description: 'Pièce d’identité (écran 07)' })
  @IsOptional()
  @IsIn(['cni', 'passport', 'permis'])
  idDocType?: 'cni' | 'passport' | 'permis';
  @ApiPropertyOptional({ maxLength: 200, description: 'Adresse de la boutique ou du domicile (facultative, jamais publique)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;
}

export class PayoutNumberDto {
  @ApiProperty({ example: '+2250707123456' }) @IsString() @Length(6, 20) phone!: string;
  @ApiProperty({ enum: ['wave', 'orange', 'mtn', 'moov'] }) @IsIn(['wave', 'orange', 'mtn', 'moov']) operator!: 'wave' | 'orange' | 'mtn' | 'moov';
}

export class VerifyPayoutDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() challengeId!: string;
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
}

export class RejectApplicationDto {
  @ApiProperty({ maxLength: 500, description: 'Motif donné à la personne (ce qu’il faut corriger)' }) @IsString() @Length(3, 500) reason!: string;
}

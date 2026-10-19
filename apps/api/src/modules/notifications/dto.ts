import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Jeton de notification de l'appareil connecté (fourni par Firebase Cloud Messaging dans l'app). */
export class RegisterDeviceDto {
  @ApiProperty({ description: 'Jeton FCM de l’appareil' }) @IsString() @MinLength(20) @MaxLength(4096) token!: string;
  @ApiProperty({ enum: ['android', 'ios'] }) @IsIn(['android', 'ios']) platform!: 'android' | 'ios';
  @ApiPropertyOptional({ example: '1.0.0' }) @IsOptional() @IsString() @MaxLength(20) appVersion?: string;
}

/** Préférences de notification. Heures calmes : les deux heures, ou null pour revenir à la valeur de la plateforme. */
export class NotificationPreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() remindersEnabled?: boolean;
  @ApiPropertyOptional({ example: '22:00', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, { message: 'Heure au format HH:MM.' })
  quietStart?: string | null;
  @ApiPropertyOptional({ example: '06:00', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM, { message: 'Heure au format HH:MM.' })
  quietEnd?: string | null;
}

/** Centre de notifications : filtre (Tout = sans catégorie), page suivante (`before`), taille de page. */
export class InboxQueryDto {
  @ApiPropertyOptional({ enum: ['projects', 'support', 'social', 'coins', 'orders', 'live'] }) @IsOptional() @IsIn(['projects', 'support', 'social', 'coins', 'orders', 'live']) category?: 'projects' | 'support' | 'social' | 'coins' | 'orders' | 'live';
  @ApiPropertyOptional({ description: 'Date de la dernière notification reçue (page suivante)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  before?: Date;
  @ApiPropertyOptional({ description: 'Identifiant de la dernière notification reçue (avec `before`, page suivante sans élément sauté)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  beforeId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

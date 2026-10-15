import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Création d'un projet : réponses des écrans 19 à 23 (la photo « avant » de l'écran 22 arrive avec le module médias). */
export class CreateProjectDto {
  @ApiProperty({
    enum: ['eco', 'premium'],
    description: 'Écran 19. Projet économique (solutions gratuites) ou Premium (recommandations d’achats). Choix gratuit, ouvert à tous, indépendant de l’abonnement Premium (C6).',
  })
  @IsIn(['eco', 'premium'])
  mode!: 'eco' | 'premium';
  @ApiPropertyOptional({ enum: ['small', 'medium', 'boosted'], description: 'Mode Premium uniquement ; indicatif, aucun paiement (F4)' })
  @IsOptional()
  @IsIn(['small', 'medium', 'boosted'])
  budget?: 'small' | 'medium' | 'boosted';
  @ApiProperty({ example: 'sport', description: 'Écran 20' }) @IsString() @Length(1, 40) categoryCode!: string;
  @ApiPropertyOptional({ example: 'sport_perte_poids', description: 'Écran 21' }) @IsOptional() @IsString() @Length(1, 40) goalCode?: string;
  @ApiPropertyOptional({ example: 10, description: 'Quantité (ex. kilos) si l’objectif en a une' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  targetQuantity?: number;
  @ApiPropertyOptional({ example: 'Perdre du ventre avant mon mariage en décembre' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiPropertyOptional({ default: false, description: 'Enregistré ; les offres arrivent avec le lot 5' })
  @IsOptional()
  @IsBoolean()
  receiveMerchantOffers?: boolean;
  @ApiPropertyOptional({ example: 172 }) @IsOptional() @IsInt() @Min(50) @Max(250) heightCm?: number;
  @ApiPropertyOptional({ example: 84 }) @IsOptional() @IsInt() @Min(20) @Max(400) weightKg?: number;
  @ApiPropertyOptional({ enum: ['beginner', 'intermediate', 'advanced'] })
  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  level?: 'beginner' | 'intermediate' | 'advanced';
  @ApiPropertyOptional({ enum: ['morning', 'noon', 'afternoon'] })
  @IsOptional()
  @IsIn(['morning', 'noon', 'afternoon'])
  availability?: 'morning' | 'noon' | 'afternoon';
  @ApiPropertyOptional({ example: 3 }) @IsOptional() @IsInt() @Min(1) @Max(7) sessionsPerWeek?: number;
  @ApiPropertyOptional({ example: 'Douleur au genou', description: 'Privé ; BIM ne donne aucun avis médical' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  healthNote?: string;
  @ApiPropertyOptional({ example: 60, description: 'Si aucun modèle validé n’existe : une des durées de projects.durations_days' })
  @IsOptional()
  @IsInt()
  durationDays?: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isPublic?: boolean;
}

export class UpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
  @ApiPropertyOptional({ enum: ['eco', 'premium'], description: 'Changer de mode (écran 19 : « Tu pourras changer de mode plus tard ») ; gratuit, sans lien avec l’abonnement (C6)' })
  @IsOptional()
  @IsIn(['eco', 'premium'])
  mode?: 'eco' | 'premium';
  @ApiPropertyOptional({ enum: ['small', 'medium', 'boosted'], description: 'Obligatoire si le mode devient Premium' })
  @IsOptional()
  @IsIn(['small', 'medium', 'boosted'])
  budget?: 'small' | 'medium' | 'boosted';
}

export class AddTaskDto {
  @ApiProperty({ example: 'Étirements' }) @IsString() @Length(2, 80) title!: string;
  @ApiPropertyOptional({ example: '15 min' }) @IsOptional() @IsString() @MaxLength(200) detail?: string;
  @ApiProperty({ example: '21:00' }) @Matches(TIME, { message: "L'heure doit être au format HH:MM." }) timeOfDay!: string;
  @ApiProperty({ example: 127, description: 'Jours : bit 0 = lundi … bit 6 = dimanche ; 127 = tous les jours' })
  @IsInt()
  @Min(1)
  @Max(127)
  weekdays!: number;
}

export class PauseDto {
  @ApiProperty({ example: 3, description: 'Écran 29 : 1 jour, 3 jours, 1 semaine ou autre' }) @IsInt() @Min(1) @Max(365) days!: number;
}

export class ReportDto {
  @ApiProperty({ example: '2026-10-14' }) @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' }) day!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() taskId?: string;
  @ApiProperty({ enum: ['unavailable', 'too_hard', 'health', 'content', 'other'] })
  @IsIn(['unavailable', 'too_hard', 'health', 'content', 'other'])
  reason!: 'unavailable' | 'too_hard' | 'health' | 'content' | 'other';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) message?: string;
}

/** Signalement (écrans 21 et 27), en JSON ou en multipart avec une image dans le champ « image ». */
export class SendReportDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Absent : problème général (« Résoudre un problème »)' }) @IsOptional() @IsUUID() projectId?: string;
  @ApiPropertyOptional({ example: '2026-10-14', description: 'Jour du projet concerné (obligatoire avec un projet)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date au format AAAA-MM-JJ.' })
  day?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() taskId?: string;
  @ApiProperty({ enum: ['unavailable', 'too_hard', 'health', 'content', 'other', 'app', 'product'], description: 'Projet : unavailable, too_hard, health, content, other. Général : app, product, health, other.' })
  @IsIn(['unavailable', 'too_hard', 'health', 'content', 'other', 'app', 'product'])
  reason!: string;
  @ApiPropertyOptional({ description: 'Obligatoire pour un problème général (10 caractères au moins)' }) @IsOptional() @IsString() @MaxLength(1000) message?: string;
}

export class MeasurementDto {
  @ApiProperty({ example: 82.5, description: 'Valeur dans l’unité de l’objectif (ex. kg), une décimale au plus' }) @IsNumber({ maxDecimalPlaces: 1 }) @Min(1) @Max(1000) value!: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class StartPeniConversationDto {
  @ApiProperty({
    enum: ['new_project', 'choose_goal'],
    description: 'new_project : construire tout le projet (écrans 19, 20, 25) ; choose_goal : seulement l’objectif (« Pas sûr ? », écran 21)',
  })
  @IsIn(['new_project', 'choose_goal'])
  purpose!: 'new_project' | 'choose_goal';
  @ApiPropertyOptional({ example: 'sport', description: 'Catégorie déjà choisie à l’écran 20 (choose_goal)' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  categoryCode?: string;
  @ApiPropertyOptional({ enum: ['eco', 'premium'], description: 'Mode déjà choisi à l’écran 19 (Peni ne le redemande pas)' })
  @IsOptional()
  @IsIn(['eco', 'premium'])
  mode?: 'eco' | 'premium';
  @ApiPropertyOptional({ enum: ['small', 'medium', 'boosted'] })
  @IsOptional()
  @IsIn(['small', 'medium', 'boosted'])
  budget?: 'small' | 'medium' | 'boosted';
}

export class PeniMessageDto {
  @ApiPropertyOptional({ example: 'Je veux perdre du ventre avant mon mariage en décembre', description: 'Message libre (exclusif de « choice »)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  text?: string;
  @ApiPropertyOptional({ example: 'sessions:2', description: 'Identifiant d’une réponse rapide proposée par le dernier message de Peni' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  choice?: string;
}

export class EncouragementQueryDto {
  @ApiProperty({ enum: ['day', 'map'], description: 'day : écran 27 (journée) ; map : écran 26 (carte du projet)' })
  @IsIn(['day', 'map'])
  context!: 'day' | 'map';
  @ApiPropertyOptional({ example: '2026-10-15', description: 'Jour affiché (écran 27) ; aujourd’hui par défaut' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day?: string;
}

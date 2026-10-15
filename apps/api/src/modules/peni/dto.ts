import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class StartPeniConversationDto {
  @ApiProperty({ enum: ['new_project'], description: 'Écrans 19, 20 et 25 : construire un projet avec Peni' })
  @IsIn(['new_project'])
  purpose!: 'new_project';
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

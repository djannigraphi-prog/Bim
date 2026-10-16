import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export class StartConversationDto {
  @ApiProperty({ example: 'awa.kone', description: 'Nom d’utilisateur de la personne' }) @IsString() @Length(2, 40) username!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) text?: string;
}

/** 6-B — Écrire à une boutique (« Discuter »), depuis un article, une offre de projet ou le profil de la boutique. */
export class StartShopConversationDto {
  @ApiProperty({ example: 'boutique-elegance', description: 'Adresse (slug) de la boutique' }) @IsString() @Length(1, 80) shopSlug!: string;
  @ApiPropertyOptional({ description: 'Article dont on parle (bandeau de la conversation)' }) @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ description: 'Offre reçue pour un de mes projets (écran 49)' }) @IsOptional() @IsUUID() offerId?: string;
}

/** 6-B — Réponse rapide d'une boutique (écran 51). */
export class QuickReplyDto {
  @ApiProperty({ maxLength: 200, example: 'Disponible ✅' }) @IsString() @Length(1, 200) text!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { MESSAGE_REACTIONS } from '../../database/schema';

export class StartConversationDto {
  @ApiProperty({ example: 'awa.kone', description: 'Nom d’utilisateur de la personne' }) @IsString() @Length(2, 40) username!: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) text?: string;
  @ApiPropertyOptional({ description: '6-C : message cité (même conversation, publié)' }) @IsOptional() @IsUUID() replyToId?: string;
  @ApiPropertyOptional({ description: 'V1 : article du BimShop partagé (seul dans le message)' }) @IsOptional() @IsUUID() productId?: string;
}

/** 6-C — Réaction à un message (liste fermée). */
export class ReactionDto {
  @ApiProperty({ enum: MESSAGE_REACTIONS, example: '❤️' }) @IsIn(MESSAGE_REACTIONS as unknown as string[]) emoji!: string;
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

/** V1 — Créer un groupe (18 ans et plus) : nom et personnes à ajouter (noms d'utilisateur). */
export class CreateGroupDto {
  @ApiProperty({ example: 'Team running Cocody', maxLength: 60 }) @IsString() @Length(1, 60) title!: string;
  @ApiProperty({ type: [String], example: ['awa.kone', 'koffi.yao'] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64) @IsString({ each: true }) @Length(2, 40, { each: true }) usernames!: string[];
}

export class AddGroupMembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(64) @IsString({ each: true }) @Length(2, 40, { each: true }) usernames!: string[];
}

export class RenameGroupDto {
  @ApiProperty({ maxLength: 60 }) @IsString() @Length(1, 60) title!: string;
}

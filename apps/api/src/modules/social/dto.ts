import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

export const VISIBILITIES = ['public', 'followers', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Champs texte d'une publication simple (écran 16) ; les images arrivent en multipart (`images`, 4 au plus). */
export class CreatePostDto {
  @ApiPropertyOptional({ maxLength: 2200 }) @IsOptional() @IsString() @MaxLength(2200) text?: string;
  @ApiPropertyOptional({ enum: VISIBILITIES, default: 'public', description: 'Tout le monde, mes abonnés, moi seul' })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;
}

/** Lot 11 : Reel (la vidéo arrive en multipart, champ `video`). */
export class CreateReelDto {
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @MaxLength(300) caption?: string;
  @ApiPropertyOptional({ enum: ['public', 'followers'], default: 'public' }) @IsOptional() @IsIn(['public', 'followers']) visibility?: 'public' | 'followers';
}

/** « J'ai fait mon BIM » (écrans 16 et 31) : photos avant / après d'un projet, publiées avec l'accord de la personne. */
export class CreateBimPostDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() projectId!: string;
  @ApiPropertyOptional({ maxLength: 2200 }) @IsOptional() @IsString() @MaxLength(2200) text?: string;
  @ApiPropertyOptional({ enum: VISIBILITIES, default: 'public' }) @IsOptional() @IsIn(VISIBILITIES) visibility?: Visibility;
  @ApiPropertyOptional({ type: [String], maxItems: 5, description: '5-E : produits et services utilisés (articles visibles du BimShop)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUUID('all', { each: true })
  productIds?: string[];
}

/** 5-E — Remplacer les produits et services utilisés d'un « J'ai fait mon BIM » (liste vide : tout retirer). */
export class PostProductsDto {
  @ApiProperty({ type: [String], maxItems: 5 }) @IsArray() @ArrayMaxSize(5) @IsUUID('all', { each: true }) productIds!: string[];
}

export class CreateCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 1000 }) @IsString() @Length(1, 1000) text!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Réponse à un commentaire (un seul niveau)' }) @IsOptional() @IsUUID() parentId?: string;
}

export const CONTENT_REASONS = ['spam', 'harassment', 'nudity', 'violence', 'hate', 'self_harm', 'false_info', 'other'] as const;

export class ReportContentDto {
  @ApiProperty({ enum: ['post', 'comment', 'user', 'story', 'message', 'review', 'reel'] })
  @IsIn(['post', 'comment', 'user', 'story', 'message', 'review', 'reel'])
  targetType!: 'post' | 'comment' | 'user' | 'story' | 'message' | 'review' | 'reel';
  @ApiProperty({ format: 'uuid' }) @IsUUID() targetId!: string;
  @ApiProperty({ enum: CONTENT_REASONS }) @IsIn(CONTENT_REASONS) reason!: (typeof CONTENT_REASONS)[number];
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) message?: string;
}

export class ResolveContentReportDto {
  @ApiProperty({ enum: ['none', 'hidden'], description: 'none : rien à reprocher ; hidden : publication, commentaire ou story masqué' })
  @IsIn(['none', 'hidden'])
  action!: 'none' | 'hidden';
  @ApiProperty({ maxLength: 500 }) @IsString() @Length(1, 500) resolution!: string;
}

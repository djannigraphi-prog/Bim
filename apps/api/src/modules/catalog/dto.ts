import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class ProductDto {
  @ApiPropertyOptional({ enum: ['product', 'service'], default: 'product' }) @IsOptional() @IsIn(['product', 'service']) kind?: 'product' | 'service';
  @ApiProperty({ example: 'Robe soirée à plumes' }) @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty({ example: 'vetements_soiree', description: 'Sous-rubrique (écran 33)' }) @IsString() @Length(2, 40) categoryCode!: string;
  @ApiProperty({ example: 45000, description: 'Prix en FCFA' }) @IsInt() @Min(1) @Max(100_000_000) priceFcfa!: number;
  @ApiPropertyOptional({ example: 60000, description: 'Prix barré (promotion), supérieur au prix' }) @IsOptional() @IsInt() @Min(2) @Max(100_000_000) compareAtFcfa?: number | null;
  @ApiPropertyOptional({ example: 60, description: 'Prestation : durée en minutes' }) @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number | null;
}

export class UpdateProductDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 40) categoryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000_000) priceFcfa?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(2) @Max(100_000_000) compareAtFcfa?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(5) @Max(1440) durationMinutes?: number | null;
  @ApiPropertyOptional({ description: '7-A : confirmation, après avertissement, de la remise à zéro de la réputation d’un article déjà publié' })
  @IsOptional()
  @IsBoolean()
  confirmReputationReset?: boolean;
}

export class VariantsDto {
  @ApiProperty({ example: ['XS', 'S', 'M', 'L', 'XL'], description: 'Libellés des variantes (taille, couleur…) ; vide : « Unique »' })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 60, { each: true })
  labels!: string[];
  @ApiPropertyOptional({ description: '7-A : confirmation de la remise à zéro de la réputation (variantes ajoutées, retirées ou renommées)' })
  @IsOptional()
  @IsBoolean()
  confirmReputationReset?: boolean;
}

export class StockDto {
  @ApiProperty({ example: 12, description: 'Nouveau stock de la variante (le mouvement est calculé)' }) @IsInt() @Min(0) @Max(100000) quantity!: number;
}

export class UpdateShopDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 80) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) commune?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { LIVE_HEARTS_MAX } from './lives.service';

export class CreateLiveDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(1, 100) title!: string;
  @ApiPropertyOptional({ description: 'Absent : le Live commence tout de suite ; sinon programmé (30 jours au plus)' }) @IsOptional() @IsDateString() scheduledAt?: string;
}

export class CreateShopLiveDto extends CreateLiveDto {
  @ApiPropertyOptional({ description: 'Article publié de la boutique, épinglé pendant le Live' }) @IsOptional() @IsUUID() productId?: string;
}

export class PinProductDto {
  @ApiProperty({ nullable: true, description: 'null : retirer l’article épinglé' }) @ValidateIf((_, v) => v !== null) @IsUUID() productId!: string | null;
}

export class LiveCommentDto {
  @ApiProperty({ maxLength: 300 }) @IsString() @Length(1, 300) text!: string;
}

export class LiveHeartsDto {
  @ApiProperty({ minimum: 1, maximum: LIVE_HEARTS_MAX }) @IsInt() @Min(1) @Max(LIVE_HEARTS_MAX) count!: number;
}

/** V1 — Gadgets Premium du Live : message épinglé (null pour le retirer) et ambiance. */
export class LiveGadgetsDto {
  @ApiPropertyOptional({ maxLength: 140, nullable: true }) @IsOptional() @IsString() @MaxLength(140) pinnedMessage?: string | null;
  @ApiPropertyOptional({ enum: ['classic', 'sunset', 'ocean', 'gold'] }) @IsOptional() @IsIn(['classic', 'sunset', 'ocean', 'gold']) theme?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { GIFT_MAX_QUANTITY, GIFT_TARGETS, GiftTarget, WITHDRAWAL_OPERATORS, WithdrawalOperator } from './wallet.service';

const IDEM = /^[A-Za-z0-9_-]{8,64}$/;

export class SubscribePremiumDto {
  @ApiProperty({ enum: ['demo'], description: 'Prototype : seul le circuit simulé existe (aucun paiement)' }) @IsIn(['demo']) channel!: 'demo';
}

export class BuyCoinsDto {
  @ApiProperty({ description: 'Pack choisi ou « Autre montant » entre customAmount.min et customAmount.max, en pièces (1 pièce = 1 F)' }) @IsInt() @Min(1) coins!: number;
  @ApiProperty({ enum: ['demo'] }) @IsIn(['demo']) channel!: 'demo';
  @ApiProperty({ description: 'Clé anti-doublon générée par l’app' }) @IsString() @Matches(IDEM) idempotencyKey!: string;
}

export class SendCoinsDto {
  @ApiProperty({ enum: GIFT_TARGETS }) @IsIn([...GIFT_TARGETS]) targetType!: GiftTarget;
  @ApiProperty() @IsUUID() targetId!: string;
  @ApiProperty({ description: 'Code du cadeau (voir GET /v1/wallet)' }) @IsString() @Length(2, 20) giftCode!: string;
  @ApiProperty({ minimum: 1, maximum: GIFT_MAX_QUANTITY }) @IsInt() @Min(1) @Max(GIFT_MAX_QUANTITY) quantity!: number;
  @ApiPropertyOptional({ description: 'Mon nom n’apparaît pas dans la liste des donateurs' }) @IsOptional() @IsBoolean() anonymous?: boolean;
  @ApiProperty() @IsString() @Matches(IDEM) idempotencyKey!: string;
}

export class WithdrawCoinsDto {
  @ApiProperty({ description: 'Pièces reçues à retirer' }) @IsInt() @Min(1) coins!: number;
  @ApiProperty({ enum: WITHDRAWAL_OPERATORS }) @IsIn([...WITHDRAWAL_OPERATORS]) operator!: WithdrawalOperator;
  @ApiProperty() @IsString() @Matches(IDEM) idempotencyKey!: string;
}

export class DecideWithdrawalDto {
  @ApiProperty({ enum: ['approve', 'reject'] }) @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @ApiPropertyOptional({ description: 'Motif, obligatoire pour refuser (les pièces sont rendues)' }) @IsOptional() @IsString() @Length(1, 300) reason?: string;
}

/** V1 — Achat dans l'app à vérifier auprès du magasin. */
export class StorePurchaseDto {
  @ApiProperty({ enum: ['google', 'apple'] }) @IsIn(['google', 'apple']) platform!: 'google' | 'apple';
  @ApiProperty({ example: 'bim.coins.500' }) @IsString() @Length(3, 100) productId!: string;
  @ApiProperty({ description: 'Jeton d’achat (Google) ou transaction signée (Apple) fourni par le magasin' }) @IsString() @Length(8, 8000) purchaseToken!: string;
}

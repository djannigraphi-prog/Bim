import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class OrderLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty() @IsUUID() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(99) quantity!: number;
}

export class ProposalLineDto extends OrderLineDto {
  @ApiPropertyOptional({ description: 'Prix négocié (A15 : jamais au-dessus du prix du catalogue)' }) @IsOptional() @IsInt() appliedPriceFcfa?: number;
}

export class FulfilmentDto {
  @ApiProperty({ enum: ['pickup', 'express', 'economy'] }) @IsIn(['pickup', 'express', 'economy']) deliveryMode!: 'pickup' | 'express' | 'economy';
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^[a-z0-9-]{3,80}$/) communeCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) address?: string;
  @ApiProperty({ enum: ['mobile_money', 'cash'] }) @IsIn(['mobile_money', 'cash']) paymentMethod!: 'mobile_money' | 'cash';
}

export class PreviewOrderDto extends FulfilmentDto {
  @ApiProperty() @IsUUID() shopId!: string;
  @ApiProperty({ type: [OrderLineDto] }) @ValidateNested({ each: true }) @Type(() => OrderLineDto) @ArrayMinSize(1) @ArrayMaxSize(20) items!: OrderLineDto[];
}

export class CreateOrderDto extends PreviewOrderDto {
  @ApiProperty({ description: 'Montant total affiché au client ; refusé (PRICE_CHANGED) s’il diffère du calcul du serveur' }) @IsInt() expectedTotalFcfa!: number;
  @ApiProperty({ description: 'Clé anti-doublon générée par l’app pour cette commande' }) @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) idempotencyKey!: string;
}

export class AcceptProposalDto extends FulfilmentDto {
  @ApiProperty() @IsInt() expectedTotalFcfa!: number;
}

export class ProposeOrderDto {
  @ApiProperty() @IsUUID() conversationId!: string;
  @ApiProperty({ type: [ProposalLineDto] }) @ValidateNested({ each: true }) @Type(() => ProposalLineDto) @ArrayMinSize(1) @ArrayMaxSize(20) items!: ProposalLineDto[];
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{8,64}$/) idempotencyKey!: string;
}

export class ReasonDto {
  @ApiProperty() @IsString() @Length(3, 300) reason!: string;
}

export class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) reason?: string;
}

export class HandoverDto {
  @ApiProperty({ example: '1234' }) @IsString() @Length(1, 8) code!: string;
}

export class DeclarePaymentDto {
  @ApiPropertyOptional({ description: 'Référence de la transaction saisie par le client (facultative, jamais vérifiée)' }) @IsOptional() @IsString() @Length(0, 60) reference?: string;
}

export class CashReceivedDto {
  @ApiProperty() @IsInt() @Min(1) amountFcfa!: number;
}

export class ReviewNoteDto {
  @ApiProperty() @IsString() @Length(3, 300) note!: string;
}

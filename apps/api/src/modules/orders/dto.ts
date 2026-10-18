import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

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

export class ReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @Length(0, 1000) comment?: string;
}

export class ReviewNoteDto {
  @ApiProperty() @IsString() @Length(3, 300) note!: string;
}

export class RefuseDeliveryDto {
  @ApiProperty({ enum: ['incorrect', 'damaged', 'incomplete', 'other'] }) @IsIn(['incorrect', 'damaged', 'incomplete', 'other']) reason!: 'incorrect' | 'damaged' | 'incomplete' | 'other';
  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @IsString() @Length(0, 300) details?: string;
}

export class OfferCourierDto {
  @ApiProperty() @IsUUID() courierId!: string;
  @ApiPropertyOptional({ description: 'Motif obligatoire en économique si un livreur prioritaire disponible est passé' }) @IsOptional() @IsString() @Length(0, 300) reason?: string;
}

export class IncidentDto {
  @ApiProperty({ enum: ['item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'] })
  @IsIn(['item_incorrect', 'item_damaged', 'item_incomplete', 'client_absent', 'courier_absent', 'courier_not_there', 'delay', 'payment', 'behaviour', 'other'])
  reason!: 'item_incorrect' | 'item_damaged' | 'item_incomplete' | 'client_absent' | 'courier_absent' | 'courier_not_there' | 'delay' | 'payment' | 'behaviour' | 'other';
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @Length(0, 1000) description?: string;
}

export class IncidentNoteDto {
  @ApiProperty() @IsString() @Length(2, 1000) note!: string;
}

export class CodeDto {
  @ApiProperty({ example: '1234' }) @IsString() @Length(1, 8) code!: string;
}

export class CourierNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class ReportReviewDto {
  @ApiProperty({ enum: ['spam', 'harassment', 'hate', 'false_info', 'other'] }) @IsIn(['spam', 'harassment', 'hate', 'false_info', 'other']) reason!: string;
}

/** V1 — Nouvelle tentative de livraison : le client accepte de payer une deuxième fois les frais. */
export class RetryDeliveryDto {
  @ApiProperty({ description: 'Le client accepte les frais de la nouvelle tentative' }) @IsBoolean() acceptFee!: boolean;
}

/** V1 — Réponse du livreur à une demande de changement de livreur. */
export class ReassignAnswerDto {
  @ApiProperty() @IsBoolean() accept!: boolean;
}

import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export const AVATARS = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'] as const

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '昵称不能为空' })
  @MaxLength(16, { message: '昵称最多 16 字符' })
  nickname?: string

  @IsOptional()
  @IsIn(AVATARS as unknown as string[])
  avatar?: string
}

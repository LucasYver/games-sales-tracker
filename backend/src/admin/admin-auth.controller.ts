import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { LoginDto } from './dto/login.dto';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  /** Public — email/password → signed session token. */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@Req() req: Request & { adminUser?: { id: string; email: string } }) {
    return { email: req.adminUser?.email ?? null };
  }

  @Get('users')
  @UseGuards(AdminAuthGuard)
  listUsers() {
    return this.auth.listUsers();
  }

  /** Allowlist: only an already-authenticated admin can add another. */
  @Post('users')
  @UseGuards(AdminAuthGuard)
  createUser(@Body() dto: CreateAdminUserDto) {
    return this.auth.createUser(dto.email, dto.password);
  }
}

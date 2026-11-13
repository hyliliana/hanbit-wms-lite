import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { PrismaService } from "./prisma.service";

export type Role = "ADMIN" | "MANAGER" | "WORKER" | "SHIPPER";
export type AuthUser = { id: number; name: string; role: Role; shipperId: number | null };

export const PUBLIC = "isPublic";
export const ROLES = "roles";
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export function hashPassword(pw: string) {
  const salt = randomBytes(8).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function checkPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const a = scryptSync(pw, salt, 32);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 모든 요청의 로그인·역할을 처리 서버에서 확인한다 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private prisma: PrismaService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("로그인이 필요합니다");
    const s = await this.prisma.session.findUnique({ where: { token }, include: { user: true } });
    if (!s || s.expiresAt < new Date()) throw new UnauthorizedException("로그인이 만료되었습니다");
    const u = s.user;
    req.user = { id: u.id, name: u.name, role: u.role, shipperId: u.shipperId } as AuthUser;
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles && !roles.includes(u.role as Role)) throw new ForbiddenException("이 기능을 쓸 권한이 없습니다");
    return true;
  }
}

/** 화주사 계정은 자기 화주사만. 다른 화주사를 요청하면 403 */
export function scopeShipper(user: AuthUser, requested?: number | null): number | undefined {
  if (user.role === "SHIPPER") {
    if (requested && requested !== user.shipperId) throw new ForbiddenException("다른 화주사의 정보는 볼 수 없습니다");
    return user.shipperId!;
  }
  return requested ?? undefined;
}

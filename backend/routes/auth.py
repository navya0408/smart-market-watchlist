from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from models import User

from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
)


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)


# =========================================================
# Request Schemas
# =========================================================

class AuthRequest(BaseModel):
    name: str | None = None
    email: EmailStr
    password: str


# =========================================================
# Signup
# =========================================================

@router.post("/signup")
def signup(
    data: AuthRequest,
    db: Session = Depends(get_db),
):
    name = data.name.strip() if data.name else ""
    email = str(data.email).strip().lower()
    password = data.password
    if not name:
        raise HTTPException(
            status_code=400,
            detail="Name is required",
        )

    if len(password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters",
        )

    existing_user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists",
        )

    user = User(
    name=name,
    email=email,
    password_hash=hash_password(password),
)

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)

    return {
        "message": "Account created successfully",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
    }


# =========================================================
# Login
# =========================================================

@router.post("/login")
def login(
    data: AuthRequest,
    db: Session = Depends(get_db),
):
    email = str(data.email).strip().lower()
    password = data.password

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    if not user.password_hash:
        raise HTTPException(
            status_code=401,
            detail="This account does not have a password set. Please create a new account.",
        )

    if not verify_password(
        password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    token = create_access_token(user.id)

    return {
        "message": "Login successful",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
    }


# =========================================================
# Current User
# =========================================================

@router.get("/me")
def get_me(
    current_user: User = Depends(get_current_user),
):
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
    }
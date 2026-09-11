-- Section scoping for exams, and bus fee discounts.
--
-- Every column here is nullable or has a default, so existing rows keep
-- working unchanged: an ExamClass with a NULL `sections` means "the whole
-- class" (how every exam behaved before), and a BusFeePayment with
-- discount = 0 and a NULL grossFee is exactly a pre-discount payment.

-- AlterTable: which sections of a class sit a given exam. CSV, e.g. "A,B".
-- NULL = the whole class.
ALTER TABLE "ExamClass" ADD COLUMN "sections" TEXT;

-- AlterTable: standing per-rider bus fee discount (enrolled students)
ALTER TABLE "Student" ADD COLUMN "busFeeDiscount" REAL;
ALTER TABLE "Student" ADD COLUMN "busFeeDiscountReason" TEXT;

-- AlterTable: standing per-rider bus fee discount (bus-only passengers)
ALTER TABLE "BusPassenger" ADD COLUMN "busFeeDiscount" REAL;
ALTER TABLE "BusPassenger" ADD COLUMN "busFeeDiscountReason" TEXT;

-- AlterTable: per-payment discount breakdown. `amount` keeps its existing
-- meaning — what was actually received, i.e. already net of `discount` — so
-- every collection total in the existing reports stays correct.
ALTER TABLE "BusFeePayment" ADD COLUMN "grossFee" REAL;
ALTER TABLE "BusFeePayment" ADD COLUMN "discount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "BusFeePayment" ADD COLUMN "discountReason" TEXT;

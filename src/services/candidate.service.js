const fs = require('fs');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const Referral = require('../models/Referral');
const CandidateInteraction = require('../models/CandidateInteraction');
const { logActivity } = require('./activity.service');

async function getMyCandidateProfile(userId) {
  const candidate = await Candidate.findOne({ userId, isDeleted: false })
    .populate('desiredJobId', 'name nameAr categoryId')
    .populate('categoryId', 'name nameAr');

  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  return candidate;
}

async function updateMyCandidateProfile(userId, updateData) {
  const candidate = await Candidate.findOne({ userId, isDeleted: false });
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  const {
    fullName,
    email,
    desiredJobId,
    governorate,
    area,
    yearsOfExperience,
    qualification,
    skills,
    availabilityStatus
  } = updateData;

  if (fullName && fullName.trim()) {
    candidate.fullName = fullName.trim();
  }

  if (email !== undefined) {
    candidate.email = email ? email.trim().toLowerCase() : '';
  }

  if (desiredJobId && desiredJobId !== String(candidate.desiredJobId)) {
    const job = await Job.findById(desiredJobId);
    if (!job || !job.isActive) {
      throw { statusCode: 400, message: 'Selected job is not active or invalid.', code: 'INVALID_JOB' };
    }
    candidate.desiredJobId = job._id;
    candidate.categoryId = job.categoryId;
  }

  if (governorate) candidate.governorate = governorate;
  if (area) candidate.area = area;
  if (yearsOfExperience !== undefined) candidate.yearsOfExperience = Number(yearsOfExperience) || 0;
  if (qualification) candidate.qualification = qualification;

  if (skills !== undefined) {
    if (Array.isArray(skills)) {
      candidate.skills = skills;
    } else if (typeof skills === 'string') {
      candidate.skills = skills.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  if (availabilityStatus && ['Available', 'Contacted', 'Interviewing', 'Hired', 'Not Available'].includes(availabilityStatus)) {
    candidate.availabilityStatus = availabilityStatus;
  }

  await candidate.save();

  return candidate.populate([
    { path: 'desiredJobId', select: 'name nameAr categoryId' },
    { path: 'categoryId', select: 'name nameAr' }
  ]);
}

async function updateAvailability(userId, availabilityStatus) {
  if (!['Available', 'Contacted', 'Interviewing', 'Hired', 'Not Available'].includes(availabilityStatus)) {
    throw { statusCode: 400, message: 'Invalid availability status.', code: 'INVALID_STATUS' };
  }

  const candidate = await Candidate.findOneAndUpdate(
    { userId, isDeleted: false },
    { availabilityStatus },
    { new: true }
  );

  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  return candidate;
}

async function attachCv(userId, file) {
  if (!file) {
    throw { statusCode: 400, message: 'No CV file uploaded.', code: 'FILE_REQUIRED' };
  }

  const candidate = await Candidate.findOne({ userId, isDeleted: false });
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  // Remove old CV if exists
  if (candidate.cvUrl && fs.existsSync(candidate.cvUrl)) {
    try {
      fs.unlinkSync(candidate.cvUrl);
    } catch (e) {
      console.warn('Could not remove previous CV:', e.message);
    }
  }

  candidate.cvUrl = file.path;
  candidate.cvOriginalName = file.originalname;
  candidate.cvMimeType = file.mimetype;
  candidate.cvSize = file.size;
  candidate.cvUploadedAt = new Date();

  await candidate.save();

  return {
    cvOriginalName: candidate.cvOriginalName,
    cvSize: candidate.cvSize,
    cvUploadedAt: candidate.cvUploadedAt
  };
}

async function deleteCv(userId) {
  const candidate = await Candidate.findOne({ userId, isDeleted: false });
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  if (candidate.cvUrl && fs.existsSync(candidate.cvUrl)) {
    try {
      fs.unlinkSync(candidate.cvUrl);
    } catch (e) {
      console.warn('Could not remove CV file:', e.message);
    }
  }

  candidate.cvUrl = null;
  candidate.cvOriginalName = null;
  candidate.cvMimeType = null;
  candidate.cvSize = 0;
  candidate.cvUploadedAt = null;

  await candidate.save();

  return { success: true };
}

async function deactivateMyCandidate(userId) {
  const candidate = await Candidate.findOne({ userId, isDeleted: false });
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  candidate.accountStatus = 'deactivated';
  candidate.availabilityStatus = 'Not Available';
  await candidate.save();

  return { success: true, message: 'Candidate profile deactivated successfully.' };
}

async function getCandidateReferralStats(userId) {
  const candidate = await Candidate.findOne({ userId, isDeleted: false });
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate profile not found.', code: 'PROFILE_NOT_FOUND' };
  }

  const referrals = await Referral.find({ referrerCandidateId: candidate._id })
    .populate('referredCandidateId', 'fullName phone availabilityStatus createdAt')
    .sort({ createdAt: -1 });

  return {
    referralCode: candidate.referralCode,
    totalReferrals: candidate.referralCount || referrals.length,
    referrals
  };
}

async function getCandidateByIdForCompany(candidateId, company, req) {
  const candidate = await Candidate.findOne({
    _id: candidateId,
    accountStatus: 'active',
    isDeleted: false
  })
    .populate('desiredJobId', 'name nameAr')
    .populate('categoryId', 'name nameAr');

  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found or is no longer available.', code: 'CANDIDATE_NOT_FOUND' };
  }

  // Record interaction: PROFILE_VIEWED
  await CandidateInteraction.create({
    companyId: company._id,
    candidateId: candidate._id,
    action: 'PROFILE_VIEWED'
  });

  // Increment company views used
  company.viewsUsed = (company.viewsUsed || 0) + 1;
  await company.save();

  await logActivity({
    actorId: company.userId,
    actorRole: 'company',
    action: 'CANDIDATE_VIEWED',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { companyName: company.companyName, candidateName: candidate.fullName },
    req
  });

  // Controlled DTO projection - hide admin notes, password, consent raw metadata
  return {
    id: candidate._id,
    fullName: candidate.fullName,
    phone: candidate.phone,
    email: candidate.email,
    desiredJob: candidate.desiredJobId,
    category: candidate.categoryId,
    governorate: candidate.governorate,
    area: candidate.area,
    yearsOfExperience: candidate.yearsOfExperience,
    qualification: candidate.qualification,
    skills: candidate.skills,
    availabilityStatus: candidate.availabilityStatus,
    hasCv: !!candidate.cvUrl,
    cvOriginalName: candidate.cvOriginalName,
    createdAt: candidate.createdAt
  };
}

module.exports = {
  getMyCandidateProfile,
  updateMyCandidateProfile,
  updateAvailability,
  attachCv,
  deleteCv,
  deactivateMyCandidate,
  getCandidateReferralStats,
  getCandidateByIdForCompany
};

"""Grading subpackage — entry point exposes compute_grade + grade_all."""
from tool_scout.grading.rubric import (
    GradeResult,
    compute_fit,
    compute_grade,
    compute_install_ease,
    compute_novelty,
    compute_quality,
    compute_relevance,
    grade_all,
    load_yaml,
    total_to_letter,
)

__all__ = [
    "GradeResult",
    "compute_fit",
    "compute_grade",
    "compute_install_ease",
    "compute_novelty",
    "compute_quality",
    "compute_relevance",
    "grade_all",
    "load_yaml",
    "total_to_letter",
]

"""Recommender package — entry points exposed at top level."""
from tool_scout.recommender.learning import (
    compute_learning_factor,
    install_count,
    profile_analyze,
)
from tool_scout.recommender.profile import Profile, Project
from tool_scout.recommender.scorer import Pick, recommend

__all__ = [
    "Pick",
    "Profile",
    "Project",
    "compute_learning_factor",
    "install_count",
    "profile_analyze",
    "recommend",
]

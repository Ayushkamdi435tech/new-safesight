def assess_priority(disaster_type, people_trapped, people_affected, description):
    # Transparent prototype rules, not an official dispatch policy.
    score = 20
    if people_trapped:
        score += 50
    if people_affected is not None:
        if people_affected >= 10:
            score += 25
        elif people_affected >= 4:
            score += 15
        elif people_affected >= 1:
            score += 5
    text = (description or "").lower()
    if any(word in text for word in ["अडक", "trapped", "stranded", "cannot get out"]):
        score += 10
    if disaster_type in {"Building Collapse", "Fire"}:
        score += 10
    score = min(score, 100)
    return score, ("HIGH" if score >= 70 else "MEDIUM" if score >= 40 else "LOW")

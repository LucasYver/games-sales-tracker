"""Portage Python fidèle du modèle d'estimation actuel (la « baseline »).

En ML, la baseline est le modèle de référence à battre : toute amélioration
doit faire mieux qu'elle sur le MÊME jeu de test, avec la MÊME métrique.
"""

from .estimator import Estimate, Estimator, MethodResult

__all__ = ["Estimate", "Estimator", "MethodResult"]
